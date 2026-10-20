import {Connector,configFromEnv,type Config} from './meross';
import {bootstrapCloud,CloudError} from './cloud';
let config:Config|null=null;
try {
 const account=await bootstrapCloud(Bun.env,Bun.env.MEROSS_STATE_PATH??'/data/cloud-session.json');
 config=configFromEnv({...Bun.env,MEROSS_KEY:account.key,MEROSS_HOST:account.host??Bun.env.MEROSS_HOST,MEROSS_DEVICE_ID:account.deviceId});
 if(!config)throw new Error('Missing device configuration');
} catch(error) {
 // Stay offline without automatic login retries when authentication needs attention.
 console.error('Meross setup unavailable:',error instanceof CloudError?error.code:'INVALID_CONFIG');
}
const port=Number(Bun.env.PORT??'3070');
if(!Number.isInteger(port)||port<1||port>65535){console.error('Invalid connector port');process.exit(1);}
const connector=new Connector(config);
const server=Bun.serve({hostname:Bun.env.HOST??'0.0.0.0',port,idleTimeout:30,fetch:r=>connector.handle(r)});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{connector.stop();server.stop();process.exit(0);});
console.info('Meross read-only connector listening');
