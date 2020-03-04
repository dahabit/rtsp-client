const Net = require ('net')
const Url = require ('url');
const httpZ = require ('./http-z');

const Emitter = require ('./Emitter');

class RTSPClient extends Emitter
{
	constructor()
	{
		super ();
		this.cseq = 1;
		this.transactions = {};
	
	}

	connect (url)
	{
		if (this.socket)
			throw new Error ("already connecting");
		
		//parse url
		this.url = Url.parse(url);
			
		//Promise base
		return new Promise ((resolve,reject)=>{
			try {
				//Connect options
				const options = {
					host: this.url.hostname,
					port: this.url.port || 554,
				};
				//Create socket
				this.socket = Net.connect(options);
				//No delay
				this.socket.setNoDelay(true);

				this.socket.on("connect",()=>{
					//Emit
					this.emitter.emit("connected",this);
					//Resolve
					resolve();
				});
				
				this.socket.on("error",(e)=>{
					//Reject
					reject(e);
				});

				this.socket.on("data",(buffer)=>{
					const str = buffer.toString();
					//Parse data
					const response = httpZ.parse(str);
					//Get Cseq
					const cseq = response.headers.find(header=>header.name=="Cseq").values[0].value;

					//If we have session
					//Check
					if (!cseq)
						return console.error("cseq not found");

					//Resolve transaction
					if (!this.transactions[cseq])
						return console.error("transaction not found");
					//Resolve it
					this.transactions[cseq].resolve(response);
					//Delete from transactions
					delete(this.transactions[cseq]);
				});
			} catch(e) {
				reject(e);
			}
		});
	}
	
	setSession(sessionId) 
	{
		this.sessionId = sessionId;
	}
	
	getRemoteAddress()
	{
		return this.socket ? this.socket.remoteAddress : "0.0.0.0";
	}

	request (method, path, headers)
	{
		return new Promise((resolve,reject)=>{
			try{
				//Get cseq
				const cseq = this.cseq++;
				//Store resolve
				const transaction = this.transactions[cseq] = {
					ts	: new Date(),
					resolve : resolve,
					reject  : reject
				};
				//Create request
				const request = {
					method		: method,
					protocol	: 'RTSP',
					protocolVersion	: 'RTSP/1.0',
					host		: this.url.hostname,
					path		: path,
					params		: {p1: 'v1'},
					headers: [
						{ name : "CSeq"		, values : [{value: cseq}]},
						{ name : "User-Agent"	, values : [{value: "medooze-rtsp-client"}]}
					]
				};

				//Add headers
				for (const[key,val] of Object.entries(headers || {}))
					//Push it
					request.headers.push({
						name	: key,
						values	: [{value: val}]
					})

				//Serialize
				const str = httpZ.build(request) + "\n";
				//Serialize and send
				this.socket.write(str,()=>{
					//Set ts 
					transaction.sent = new Date();
				});
			} catch (e) {
				reject(e);
			}
			
		});
	}

	options ()
	{
		//Send options request
		return this.request("OPTIONS",this.url.href);
	}
	
	describe ()
	{
		//Send describe request
		return this.request("DESCRIBE",this.url.href, {
			"Accept"	: "application/sdp"
		});
	}
	
	setup(control,transport)
	{
		//Get url
		const setupUrl = new Url.URL(control,this.url.href+"/");
		//Basic headers
		const headers = {transport};
		//If we have session id
		if (this.sessionId)
			headers["Session"] = this.sessionId;
		//Send request
		return this.request("SETUP", setupUrl.href, headers);
	}
	
	play(options)
	{
		//Check we have a session id
		if (!this.sessionId)
			//Error
			throw new Error("SessionId not set");
		//Basic headers
		const headers = {
			session: this.sessionId
		};
		//If we have range
		if (options && options.range)
			//Set header
			headers["Range"] = options.range;
		//Play request
		return this.request("PLAY", this.url.href, headers);
	}
	
	pause()
	{
		//Basic headers
		const headers = {
			session: this.sessionId
		};
		//Payse reques
		return this.request("PLAY", this.url.href, headers);
	}
	
	teardown()
	{
		//Basic headers
		const headers = {
			session: this.sessionId
		};
		//teardown requestt
		return this.request("TEARDOWN", this.url.href, headers);
	}
	
	close ()
	{
		//Check we are still opened
		if (!this.socket)
			return;
		
		//For each pending transaction
		for (const transaction of Object.values(this.transactions))
			//Reject it
			transaction.reject(new Error("RTSPClient is destroyed"));
		
		//Close socket
		this.socket.destroy();
		
		/**
		* RTSPClient closed event
		*
		* @name closed
		* @memberof AudioEncoder
		* @kind event
		* @argument {AudioEncoder} encoder
		*/
		this.emitter.emit("closed", this);
		
		//Stop emitter
		super.stop();
		
		//Null
		this.socket = null;
		this.transactions = null;
	}

}


module.exports = RTSPClient;