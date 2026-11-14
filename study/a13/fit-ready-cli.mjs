import {CONFIG,calibrateReadyTimeGrid} from './model.mjs';
const result=calibrateReadyTimeGrid(CONFIG,{developmentSeeds:12});
console.log(JSON.stringify(result));
