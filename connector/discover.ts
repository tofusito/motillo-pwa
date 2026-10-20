import {CloudError,listCloudDevices} from './cloud';

try{
 const devices=await listCloudDevices(Bun.env);
 console.log(JSON.stringify(devices,null,2));
}catch(error){
 console.error(error instanceof CloudError?error.code:'CLOUD_UNAVAILABLE');
 process.exitCode=1;
}
