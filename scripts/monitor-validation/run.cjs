// Disposable native-platform validation. Runs the real app and OS display APIs.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const root=process.cwd(), dir=__dirname;
const out=path.join(root,'monitor-validation-results');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ha184-native-'));
const control=process.platform==='win32'?'\\\\.\\pipe\\ha184-monitor-validation':path.join(os.tmpdir(),'ha184-monitor.sock');
const rows=[];let appProcess,macProcess,macRead='',macWaiters=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function rpc(expression){return new Promise((resolve,reject)=>{
 const socket=net.createConnection(control);let text='';
 socket.on('connect',()=>socket.write(JSON.stringify({expression})+'\n'));
 socket.on('error',reject);socket.setTimeout(20000,()=>{socket.destroy();reject(Error('App RPC timeout'));});
 socket.on('data',chunk=>{text+=chunk;if(text.includes('\n')){socket.end();const r=JSON.parse(text.slice(0,text.indexOf('\n')));r.error?reject(Error(r.error)):resolve(r.value);}});
});}
const state=()=>rpc(`({bounds:mainWindow.getBounds(),visible:mainWindow.isVisible(),preference:config.windowDisplay,position:config.windowPosition,displays:electronScreen.getAllDisplays(),primaryId:String(electronScreen.getPrimaryDisplay().id),mainDisplayId:String(electronScreen.getDisplayMatching(mainWindow.getBounds()).id),choice:getWindowDisplaySettings(),pins:[...desktopPinWindows].map(([id,w])=>({id,bounds:w.getBounds()}))})`);
const renderer=js=>rpc(`mainWindow.webContents.executeJavaScript(${JSON.stringify(js)})`);
const disk=()=>JSON.parse(fs.readFileSync(path.join(profile,'config.json'),'utf8'));
async function until(check,label,timeout=20000){let last;const end=Date.now()+timeout;while(Date.now()<end){try{last=await state();if(await check(last))return last;}catch(e){last=e.message;}await pause(150);}throw Error(`Timeout ${label}: ${JSON.stringify(last)}`);}
function save(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({platform:process.platform,versions:process.versions,rows},null,2));}
async function test(name,fn){try{const details=await fn();rows.push({name,status:'PASS',details,state:await state()});console.log('PASS '+name);save();}catch(e){rows.push({name,status:'FAIL',error:e.stack});save();throw e;}}
function mac(op){return new Promise((resolve,reject)=>{macWaiters.push({resolve,reject});macProcess.stdin.write(JSON.stringify({op})+'\n');});}
function windows(action){
 const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'windows-control.ps1'),'-Action',action],{encoding:'utf8',timeout:90000});
 fs.appendFileSync(path.join(out,'windows-control.log'),`${action}\n${output}\n`);
 return output;
}
async function displayOp(op){return process.platform==='darwin'?mac(op):windows(op);}
async function launch(){
 if(process.platform!=='win32')fs.rmSync(control,{force:true});
 const env={...process.env,HA184_CONTROL:control};delete env.ELECTRON_RUN_AS_NODE;
 const fd=fs.openSync(path.join(out,'electron.log'),'a');
 appProcess=spawn(require('electron'),[path.join(dir,'boot.cjs'),`--user-data-dir=${profile}`,'--disable-gpu'],{cwd:root,env,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 await until(async()=>rpc('!!mainWindow && !mainWindow.webContents.isLoading()'),'app ready',45000);
}
async function stop(){if(!appProcess||appProcess.exitCode!==null)return;const exited=new Promise(r=>appProcess.once('exit',r));await rpc('(setTimeout(()=>app.quit(),20),true)').catch(()=>{});await Promise.race([exited,pause(10000)]);if(appProcess.exitCode===null){appProcess.kill();await pause(500);}}
const closeTo=(a,b)=>Math.abs(a-b)<=1;
function expected(s,id,offset){const d=s.displays.find(d=>String(d.id)===id)||s.displays.find(d=>String(d.id)===s.primaryId);const a=d.workArea;return {x:Math.round(a.x+Math.max(0,Math.min(offset.x,a.width-s.bounds.width))),y:Math.round(a.y+Math.max(0,Math.min(offset.y,a.height-s.bounds.height)))};}
function at(s,p){return closeTo(s.bounds.x,p.x)&&closeTo(s.bounds.y,p.y);}
async function tray(id){await rpc(`buildTrayContextMenu().items.find(i=>i.label==='Move to Monitor').submenu.items[${id===''?0:`1+getWindowDisplaySettings().displays.findIndex(d=>d.id===${JSON.stringify(id)})`}].click()`);await until(s=>s.preference?.id===id||(id===''&&s.preference===null),'tray preference');await until(()=>disk().windowDisplay?.id===id||(id===''&&disk().windowDisplay===null),'tray persisted');}
async function screenshot(name){await rpc(`mainWindow.capturePage().then(image=>fs.writeFileSync(${JSON.stringify(path.join(out,name+'.png'))},image.toPNG()))`);}
(async()=>{
 let macSetup;
 if(process.platform==='darwin'){
  macProcess=spawn(path.join(dir,'mac-displays'),[],{stdio:['pipe','pipe','inherit']});
  macProcess.stdout.on('data',chunk=>{macRead+=chunk;let end;while((end=macRead.indexOf('\n'))>=0){const line=macRead.slice(0,end);macRead=macRead.slice(end+1);const waiter=macWaiters.shift();if(waiter){try{waiter.resolve(JSON.parse(line));}catch(e){waiter.reject(e);}}}});
  macProcess.on('exit',code=>macWaiters.splice(0).forEach(w=>w.reject(Error('Display helper exited '+code))));
  macSetup=await mac('setup');fs.writeFileSync(path.join(out,'mac-setup.json'),JSON.stringify(macSetup,null,2));await pause(2000);
  const retina=await mac('retina');fs.writeFileSync(path.join(out,'mac-retina.json'),JSON.stringify(retina,null,2));await pause(1000);
 }
 fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({windowPosition:{x:100,y:100},windowSize:{width:400,height:400},alwaysOnTop:false,opacity:1,frostedGlass:false,globalHotkeys:{enabled:false,hotkeys:{}},ui:{language:'en',theme:'dark',scale:1},desktopPins:{'light.virtual_test':{x:100,y:520,width:168,height:148}},omarchyThemeDefaultApplied:true}));
 await launch();await pause(1200);
 let s=await state();fs.writeFileSync(path.join(out,'initial-displays.json'),JSON.stringify(s,null,2));
 assert(s.displays.length>=2,'OS must expose distinct displays');
 const primary=s.primaryId;
 const target=process.platform==='darwin'?String(macSetup.two.id):String([...s.displays].filter(d=>String(d.id)!==primary).sort((a,b)=>(b.scaleFactor-a.scaleFactor)||(b.bounds.x-a.bounds.x))[0].id);
 assert(s.displays.some(d=>String(d.id)===target),'Virtual target must exist in Electron');
 let pref;
 await test('Native display discovery and selector inventory',async()=>{assert(s.choice.supported);assert(s.choice.displays.length>=2);return {target,primary};});
 const scales=[...new Set(s.displays.map(d=>d.scaleFactor))];
 if(scales.length<2){rows.push({name:'OS provides mixed per-monitor DPI',status:'BLOCKED',scales,reason:'Runner/driver exposed only one scale factor'});save();}
 else await test('OS provides mixed per-monitor DPI',async()=>({scales}));
 await test('Tray moves to virtual monitor and saves relative position',async()=>{
  const before=await state(),source=before.displays.find(d=>String(d.id)===before.mainDisplayId);
  const offset={x:before.bounds.x-source.workArea.x,y:before.bounds.y-source.workArea.y};
  await tray(target);s=await until(s=>at(s,expected(s,target,offset)),'tray geometry');pref=s.preference;
  assert.deepEqual(s.pins,before.pins);assert.deepEqual(disk().windowDisplay,pref);return {offset,pref};
 });
 await test('Settings saves primary display through real renderer and IPC',async()=>{
  await renderer(`document.getElementById('settings-btn').click()`);await pause(500);
  assert.equal(await renderer(`document.getElementById('window-display').value`),target);
  await screenshot('settings-virtual-monitor');
  await renderer(`(()=>{document.getElementById('ha-url').value='http://127.0.0.1:18123';const e=document.getElementById('window-display');e.value=${JSON.stringify(primary)};e.dispatchEvent(new Event('change'));document.getElementById('save-settings').click();})()`);
  await until(s=>s.preference?.id===primary&&at(s,expected(s,primary,pref.offset)),'Settings placement');
 });
 await test('Open Settings follows tray selection across scale factors',async()=>{
  await renderer(`document.getElementById('settings-btn').click()`);await pause(300);await tray(target);
  s=await until(s=>at(s,expected(s,target,pref.offset)),'back to target');pref=s.preference;
  await until(async()=>await renderer(`document.getElementById('window-display').value`)===target,'Settings refresh');
 });
 await test('Live unplug falls back and retains preferred display and offset',async()=>{
  await displayOp('off');s=await until(s=>!s.displays.some(d=>String(d.id)===target)&&at(s,expected(s,target,pref.offset)),'unplug recovery');
  assert.deepEqual(s.preference,pref);await pause(700);assert.deepEqual(disk().windowDisplay,pref);return s.choice;
 });
 await test('Reconnect returns to the same preferred display',async()=>{
  const reply=await displayOp('on');s=await until(s=>s.displays.some(d=>String(d.id)===target)&&at(s,expected(s,target,pref.offset)),'reconnect recovery');assert.deepEqual(s.preference,pref);return reply;
 });
 await test('Hidden widget recovers through unplug and reconnect',async()=>{
  await rpc('mainWindow.hide()');await displayOp('off');await until(s=>!s.displays.some(d=>String(d.id)===target)&&at(s,expected(s,target,pref.offset)),'hidden fallback');
  await displayOp('on');s=await until(s=>s.displays.some(d=>String(d.id)===target)&&at(s,expected(s,target,pref.offset)),'hidden reconnect');assert.equal(s.visible,false);await rpc('mainWindow.show()');
 });
 await test('Restart with monitors connected restores preference and position',async()=>{await stop();await launch();s=await until(s=>at(s,expected(s,target,pref.offset)),'restart connected');assert.deepEqual(s.preference,pref);});
 await test('Monitor unplugged while app is closed falls back on startup',async()=>{
  await stop();await displayOp('off');await pause(700);await launch();s=await until(s=>!s.displays.some(d=>String(d.id)===target)&&at(s,expected(s,target,pref.offset)),'offline unplug');assert.deepEqual(s.preference,pref);
  await displayOp('on');await until(s=>s.displays.some(d=>String(d.id)===target)&&at(s,expected(s,target,pref.offset)),'offline reconnect');
 });
 await test('Reset Position uses the chosen monitor',async()=>{
  await rpc(`buildTrayContextMenu().items.find(i=>i.label==='Reset Position').click()`);s=await until(s=>at(s,expected(s,target,{x:100,y:100})),'reset');assert.equal(s.preference.id,target);pref=s.preference;
 });
 await test('Automatic retains the current position across restart',async()=>{
  const before=await state();await tray('');s=await state();assert(at(s,before.bounds));await stop();await launch();s=await until(s=>at(s,before.bounds),'Automatic restart');assert.equal(s.preference,null);
 });
 await screenshot('final-window');
 console.log(JSON.stringify({passed:rows.filter(r=>r.status==='PASS').length,blocked:rows.filter(r=>r.status==='BLOCKED').length}));
})().catch(async error=>{
 if(process.platform==='win32'){
  try{
   const observations=[];const initial=await state();
   const primary=initial.displays.find(d=>String(d.id)===initial.primaryId).workArea;
   const target=initial.displays.find(d=>d.scaleFactor>1).workArea;
   const primaryBounds={x:primary.x+100,y:primary.y+100,width:400,height:400};
   const targetBounds={x:target.x+100,y:target.y+100,width:400,height:400};
   const trials=[
    ['setBounds primary',`mainWindow.setBounds(${JSON.stringify(primaryBounds)})`],
    ['setPosition secondary',`mainWindow.setPosition(${targetBounds.x},${targetBounds.y})`],
    ['setSize after move','mainWindow.setSize(400,400)'],
    ['setBounds primary again',`mainWindow.setBounds(${JSON.stringify(primaryBounds)})`],
    ['setBounds secondary',`mainWindow.setBounds(${JSON.stringify(targetBounds)})`],
    ['setBounds secondary repeated',`mainWindow.setBounds(${JSON.stringify(targetBounds)})`],
   ];
   for(const [name,expression] of trials){await rpc(expression);const immediate=await state();await pause(1000);observations.push({name,immediate,state:await state()});}
   fs.writeFileSync(path.join(out,'windows-dpi-trials.json'),JSON.stringify(observations,null,2));
  }catch(diagnosticError){fs.writeFileSync(path.join(out,'windows-dpi-trials-error.txt'),diagnosticError.stack);}
 }
 console.error(error);fs.writeFileSync(path.join(out,'failure.txt'),error.stack);process.exitCode=1;}).finally(async()=>{await stop();if(macProcess){await mac('quit').catch(()=>{});macProcess.kill();}save();});
