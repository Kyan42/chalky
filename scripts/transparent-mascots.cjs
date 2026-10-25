// Remove only pale background connected to the frame edge, preserving enclosed
// white facial details and chalk. Requires ffmpeg on PATH.
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const path=require('node:path');
async function convert(input,output){
 const size=512, pixels=size*size, bytes=pixels*4;
 const dec=spawn('ffmpeg',['-v','error','-i',input,'-vf',`scale=${size}:${size},fps=24`,'-f','rawvideo','-pix_fmt','rgba','pipe:1']);
 const enc=spawn('ffmpeg',['-v','error','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${size}x${size}`,'-r','24','-i','pipe:0','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-crf','24','-b:v','0',output]);
 dec.stderr.pipe(process.stderr);enc.stderr.pipe(process.stderr);
 const ended=once(enc,'close');let pending=Buffer.alloc(0), count=0;
 for await(const chunk of dec.stdout){
  pending=Buffer.concat([pending,chunk]);
  while(pending.length>=bytes){
   const frame=Buffer.from(pending.subarray(0,bytes));pending=pending.subarray(bytes);
   const seen=new Uint8Array(pixels),queue=new Int32Array(pixels);let head=0,tail=0;
   function visit(p){if(seen[p])return;const i=p*4;const r=frame[i],g=frame[i+1],b=frame[i+2];if(Math.min(r,g,b)<130||Math.max(r,g,b)-Math.min(r,g,b)>70)return;seen[p]=1;queue[tail++]=p;}
   for(let x=0;x<size;x++){visit(x);visit(pixels-size+x);}for(let y=0;y<size;y++){visit(y*size);visit(y*size+size-1);}
   while(head<tail){const p=queue[head++];frame[p*4+3]=0;const x=p%size;if(x)visit(p-1);if(x<size-1)visit(p+1);if(p>=size)visit(p-size);if(p<pixels-size)visit(p+size);}
   if(!enc.stdin.write(frame))await once(enc.stdin,'drain');count++;
  }
 }
 enc.stdin.end();const [code]=await ended;if(code)throw new Error(`ffmpeg failed: ${code}`);console.log(`${output}: ${count} transparent frames`);
}
(async()=>{
 if (process.argv[3]) { await convert(process.argv[2], process.argv[3]); return; }
 const root=path.resolve('public/mascot');
 const first=process.argv[2];if(!first)throw new Error('Pass the original chalk-in-hand MP4 path');
 for(const [source,name] of [[first,'chalk-in-hand'],[path.join(root,'talking.mp4'),'talking'],[path.join(root,'thinking.mp4'),'thinking']])await convert(source,path.join(root,`${name}.webm`));
})().catch(e=>{console.error(e);process.exit(1)});
