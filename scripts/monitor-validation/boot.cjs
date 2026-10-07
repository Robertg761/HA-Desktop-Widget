const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {app} = require('electron');
const root = process.cwd();
app.setAppPath(root);
const filename = path.join(root,'main.js');
const mod = new Module(filename,module);
mod.filename=filename;
mod.paths=Module._nodeModulePaths(root);
const hook = `
require('node:net').createServer(socket=>{
 let buffer='';
 socket.on('data',chunk=>{
  buffer+=chunk;
  let end;
  while((end=buffer.indexOf('\\n'))>=0){
   const request=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
   Promise.resolve().then(()=>eval(request.expression)).then(
    value=>socket.write(JSON.stringify({value})+'\\n'),
    error=>socket.write(JSON.stringify({error:error.stack})+'\\n')
   );
  }
 });
}).listen(process.env.HA184_CONTROL);
`;
mod._compile(fs.readFileSync(filename,'utf8')+hook,filename);
