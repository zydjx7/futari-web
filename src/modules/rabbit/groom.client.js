import { GroomBridge, earMid } from "./groom-bridge.client.js";

const lift = "wash1_lift",
  paws = "wash2_paws",
  up = "wash3_cheekUp",
  down = "wash4_cheekDown",
  reach = "wash5_earReach",
  stroke = "wash6_earStroke";

// The extra time belongs to settling, licking and sitting. The two accepted
// orbits still use their original 1.82 seconds, on the native animation clock.
const rubStart=1.73, rubEnd=3.55, chest=3.85;
const foldMid=4.07, foldReach=4.24, strokeIn=4.41, strokeOut=4.71;
const unfoldReach=4.87, unfoldMid=5.03, unfoldChest=5.21;
const beats = [
  [0, null],
  [0.12, null],
  [0.55, lift], [0.73, lift],
  [0.82, down], [1.19, paws], [1.43, paws],
  [rubStart, up], [rubEnd, up],
  [chest, down], [foldMid, earMid], [foldReach, reach],
  [strokeIn, stroke], [strokeOut, stroke],
  [unfoldReach, reach], [unfoldMid, earMid], [unfoldChest, down],
  [5.30, lift], [5.48, lift], [5.87, null], [5.89, null],
];
export const groomDuration = beats.at(-1)[0];
// A call during a fold starts at the same joint angle on the return stroke.
function releasedAge(age,release){
  if(!release)return age;
  if(age<rubStart)return age*(1-release);
  if(age<chest){
    return release<.48?age+(chest-age)*ramp(0,.48,release):unfoldChest+(groomDuration-unfoldChest)*ramp(.48,1,release);
  }
  if(age<strokeIn){
    for(const [start,end,back,finish] of [[chest,foldMid,unfoldChest,unfoldMid],[foldMid,foldReach,unfoldMid,unfoldReach],[foldReach,strokeIn,unfoldReach,strokeOut]]){
      if(age<=end){age=back+(finish-back)*(age-start)/(end-start);break;}
    }
  }
  age=Math.max(age,strokeOut);
  return age+(groomDuration-age)*release;
}
export function rubProgress(phase) {
  const at=phase*groomDuration;
  return at<rubStart || at>=rubEnd ? null : (at-rubStart)/(rubEnd-rubStart);
}
// The painted heel of each short forearm stays at the chest. Its tip sweeps
// in towards the nose and returns slightly lower, once per orbit.
export function rubbingHands(progress,amount=1) {
  const t=progress, theta=4*Math.PI*(t-.074*Math.sin(2*Math.PI*t)/(2*Math.PI));
  return [-1,1].map(side=>{
    const swing=theta+side*.095*Math.sin(Math.PI*t)**2;
    const close=(1-Math.cos(swing))*.5, arc=Math.sin(swing);
    return {x:-side*(8.5*close+2.2*arc)*amount, y:(4*close+5.1*arc)*amount,
      angle:-side*(.76*close+.055*arc)*amount};
  });
}
export function groomCels(phase) {
  const time = Math.max(0, Math.min(1, phase)) * groomDuration;
  const i = beats.findIndex(([at]) => at > time);
  if (i < 1) return [null, null, 0];
  const [begin, a] = beats[i - 1],
    [end, b] = beats[i];
  const t = (time - begin) / (end - begin);
  return [a, b, a === b ? 0 : t * t * (3 - 2 * t)];
}

function surface(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext("2d", { willReadFrequently: true });
}
function ramp(low, high, x) {
  const t = Math.max(0, Math.min(1, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
}
// The guide is a bounded inverse displacement on an intact exposure. Both
// sides meet at a registered half-beat; no two paintings share a pixel.
export class GroomPaint {
  constructor(rig, face, p) {
    this.rig = rig;
    this.face = face;
    this.guide = rig.extra.groom;
    const [, , w, h] = rig.parts[lift];
    this.plate = surface(w,h);
    this.read = surface(w,h);
    this.geometry = rig.geometry(lift,face,p);
    this.calm = { ...p, action:"idle", breath:0, sniff:0, blink:0, ear:0, tilt:0 };
    this.frames = new Map();
    this.fields = new Map();
    this.output = this.plate.createImageData(w,h);
  }

  source(key) {
    if (this.frames.has(key)) return this.frames.get(key);
    const g=this.geometry, c=this.read, {width:w,height:h}=c.canvas;
    c.clearRect(0,0,w,h);
    if (key) c.drawImage(this.rig.extra.image,...this.rig.parts[key],0,0,w,h);
    else {
      c.save();
      c.scale(w/g.w,h/g.h);
      c.translate(-g.left,-g.top);
      // The first operation can be a hit test, before there is a cached sitting plate.
      const probe=this.rig.probe;
      this.rig.probe=null;
      try { this.rig.front(c,this.calm); }
      finally { this.rig.probe=probe; c.restore(); }
    }
    const pixels=c.getImageData(0,0,w,h).data;
    // Interpolate coverage-weighted pigments to preserve the approved antialiasing.
    for(let i=0;i<pixels.length;i+=4) {
      const a=pixels[i+3]/255;
      if (a<1) for(let k=0;k<3;k++) pixels[i+k]*=a;
    }
    this.frames.set(key,pixels);
    return pixels;
  }

  field(a,b,next) {
    const from=a||"idle", to=b||"idle", guides=this.guide.fields;
    const reverse=!guides[from+"/"+to];
    const id=reverse ? to+"/"+from : from+"/"+to;
    const side=Number(reverse ? !next : next);
    const cacheKey=id+":"+side;
    if (!this.fields.has(cacheKey)) {
      const bytes=Uint8Array.from(atob(guides[id][side]),ch=>ch.charCodeAt(0));
      this.fields.set(cacheKey,new Int8Array(bytes.buffer));
    }
    return this.fields.get(cacheKey);
  }

  midCanvas(){
    return this.mid??=this.contacts().painting(7).canvas;
  }
  contacts(){
    return this.bridge??=new GroomBridge(this.rig,()=>this.source(null),()=>this.rubbingCoat());
  }
  seated(c){
    const g=this.geometry;
    if(!this.seatedPlate){
      const base=surface(this.plate.canvas.width,this.plate.canvas.height);
      base.save();base.scale(base.canvas.width/g.w,base.canvas.height/g.h);base.translate(-g.left,-g.top);
      const probe=this.rig.probe;this.rig.probe=null;
      try{this.rig.front(base,this.calm);}finally{this.rig.probe=probe;base.restore();}
      this.seatedPlate=base.canvas;
    }
    if(this.rig.probe)return this.rig.cel(c,null,this.face,this.calm);
    c.drawImage(this.seatedPlate,g.left,g.top,g.w,g.h);
  }
  prepare(age){
    const n=this.prepared||0;
    if(n>=11 || age<[0,.018,.038,.062,.09,.55,.59,.84,1.20,1.90,2.15][n])return;
    this.prepared=n+1;
    try{
      if(n===0||n===1){this.source(n===0?null:lift);return;}
      const bridge=this.contacts();
      if(n===2)bridge.swatches();
      else if(n===5||n===6)bridge.prime(n===5?0:1);
      else bridge.plate(({3:1,4:4,7:2,8:3,9:7,10:5})[n]);
    }catch(error){
      if(error.name!=="SecurityError")throw error;
      this.prepared=11;
    }
  }
  play(c,phase,release){
    if(!this.rig.probe && !release)this.prepare(phase*groomDuration);
    const orbit=rubProgress(phase);
    if(orbit!==null && this.rig.extra.layers && release<.50)return this.drawRub(c,orbit,release);
    const time=orbit===null?releasedAge(phase*groomDuration,release):
      release<.75?rubEnd+(chest-rubEnd)*ramp(.50,.75,release):
      unfoldChest+(groomDuration-unfoldChest)*ramp(.75,1,release);
    let [a,b,t]=groomCels(time/groomDuration);
    if(a===paws && b===paws){
      a=down;t=1-.018*Math.sin(Math.PI*(time-1.19)/.24)**2;
    }
    if (!a && !b)return this.seated(c);
    if (a===stroke && b===stroke)return this.draw(c,a,b,t,0);
    const bridge=this.contacts();
    try {
      const frame=bridge.render(a,b,t), g=this.geometry, probe=this.rig.probe;
      if(!probe){c.drawImage(frame,g.left,g.top,g.w,g.h);return;}
      const pt=new DOMPoint(probe.x,probe.y).matrixTransform(c.getTransform().inverse());
      const x=Math.floor((pt.x-g.left)*frame.width/g.w),y=Math.floor((pt.y-g.top)*frame.height/g.h);
      if(x>=0&&x<frame.width&&y>=0&&y<frame.height)probe.hit=bridge.buffer.data[4*(y*frame.width+x)+3]>64;
    }catch(e){
      if(e.name!=="SecurityError")throw e;
      this.rig.registered(c,a,this.face,b,this.face,t,this.calm);
    }
  }

  rubbingCoat(){
    if (!this.rubBody) {
      const clean=surface(this.plate.canvas.width,this.plate.canvas.height);
      const {chest}=this.rig.extra.layers, tile=this.rig.motionPiece("chest");
      clean.drawImage(this.rig.extra.image,...this.rig.parts[up],0,0,clean.canvas.width,clean.canvas.height);
      clean.clearRect(chest[0],chest[1],chest[2]-chest[0],chest[3]-chest[1]);
      clean.drawImage(tile.canvas,chest[0]+tile.x,chest[1]+tile.y);
      this.contacts().patch(clean,"muzzleFur");
      if(this.guide.bridges.edits.shoulder)this.contacts().patch(clean,"shoulder");
      this.rubBody=clean.canvas;
      this.rubLayer=surface(clean.canvas.width,clean.canvas.height);
    }
    return this.rubBody;
  }
  drawRub(c,progress,release) {
    this.rubbingCoat();
    const amplitude=1-ramp(0,.5,release), hands=rubbingHands(progress,amplitude);
    const g=this.geometry, layer=this.rubLayer, w=layer.canvas.width,h=layer.canvas.height;
    if (progress!==this.rubAt || release!==this.rubRelease) {
      layer.clearRect(0,0,w,h);
      layer.save();
      const travel=Math.sin(2*Math.PI*progress)**2;
      const nod=(2.4*travel+.65*Math.sin(2*Math.PI*progress))*amplitude;
      // A tiny nod accumulates towards the crown; the planted heels keep
      // their ground contact. All three paintings share this breathing space.
      layer.translate(0,nod);layer.scale(1,1-nod/h);
      layer.drawImage(this.rubBody,0,0);
      for (const i of [1,0]) {
        const joint=i===0 ? [94.1,258.8] : [218.5,258.1];
        const s=this.rig.motionPiece(i===0?"left":"right"), pose=hands[i];
        layer.save();
        layer.translate(joint[0]+pose.x,joint[1]+pose.y);
        layer.rotate(pose.angle);
        layer.drawImage(s.canvas,s.x-joint[0],s.y-joint[1]);
        layer.restore();
      }
      layer.restore();
      this.rubAt=progress;this.rubRelease=release;
    }
    if (!this.rig.probe) {c.drawImage(layer.canvas,g.left,g.top,g.w,g.h);return;}
    const probe=this.rig.probe;
    const pt=new DOMPoint(probe.x,probe.y).matrixTransform(c.getTransform().inverse());
    const x=Math.floor((pt.x-g.left)*w/g.w),y=Math.floor((pt.y-g.top)*h/g.h);
    if(x<0||y<0||x>=w||y>=h)return;
    try {probe.hit=layer.getImageData(x,y,1,1).data[3]>64;}
    catch(e) {if(e.name!=="SecurityError")throw e;this.rig.cel(c,up,this.face,this.calm);}
  }

  draw(c,a,b,t,release) {
    if (release>0) {
      const nearest=t<.5?a:b;
      if (release<.2) t+=((t<.5?0:1)-t)*ramp(0,.2,release);
      else { a=nearest; b=null; t=ramp(.2,1,release); }
    }
    const next=t>=.5, key=next?b:a;
    if (a===b || t<.0001 || t>.9999) {
      if (!this.rig.probe) this.lastMask=null;
      return this.rig.cel(c,key,this.face,this.calm);
    }
    let source;
    try { source=this.source(key); }
    catch(error) {
      if(error.name!=="SecurityError") throw error;
      this.lastMask=null;
      return this.rig.registered(c,a,this.face,b,this.face,t,this.calm);
    }
    const field=this.field(a,b,next), {cols,step}=this.guide;
    const gain=Math.min(t,1-t)*.5; // quarter-pixel offsets, full strength at the half-beat
    const g=this.geometry, {width:w,height:h,data:out}=this.output;
    const probe=this.rig.probe;
    let x0=0,y0=0,x1=w,y1=h;
    if (probe) {
      const local=new DOMPoint(probe.x,probe.y).matrixTransform(c.getTransform().inverse());
      x0=Math.floor((local.x-g.left)*w/g.w); y0=Math.floor((local.y-g.top)*h/g.h);
      if (x0<0||y0<0||x0>=w||y0>=h) return;
      if (this.lastMask && this.lastField===field && this.lastGain===gain) {
        probe.hit=this.lastMask.data[4*(y0*w+x0)+3]>64;
        return;
      }
      x1=x0+1; y1=y0+1;
    }
    for(let y=y0;y<y1;y++) {
      const row=Math.floor(y/step)*cols, v=y%step/step;
      for(let cell=Math.floor(x0/step);cell*step<x1;cell++) {
        const tl=2*(row+cell), bl=tl+2*cols;
        const dx=field[tl]+v*(field[bl]-field[tl]), dy=field[tl+1]+v*(field[bl+1]-field[tl+1]);
        const ix=(field[tl+2]+v*(field[bl+2]-field[tl+2])-dx)/step;
        const iy=(field[tl+3]+v*(field[bl+3]-field[tl+3])-dy)/step;
        for(let x=Math.max(x0,cell*step);x<Math.min(x1,(cell+1)*step);x++) {
          const u=x-cell*step;
          const sx=Math.max(0,Math.min(w-1.0001,x+gain*(dx+u*ix)));
          const sy=Math.max(0,Math.min(h-1.0001,y+gain*(dy+u*iy)));
          const fx=sx%1,fy=sy%1,i=4*((sy|0)*w+(sx|0)),j=i+4*w;
          const nw=(1-fx)*(1-fy),ne=fx*(1-fy),sw=(1-fx)*fy,se=fx*fy;
          const alpha=nw*source[i+3]+ne*source[i+7]+sw*source[j+3]+se*source[j+7];
          if (probe) { probe.hit=alpha>64; return; }
          const dst=4*(y*w+x);
          out[dst+3]=alpha;
          const straight=alpha>0?255/alpha:0;
          for(let k=0;k<3;k++)
            out[dst+k]=straight*(nw*source[i+k]+ne*source[i+4+k]+sw*source[j+k]+se*source[j+4+k]);
        }
      }
    }
    this.plate.putImageData(this.output,0,0);
    this.lastMask=this.output;
    this.lastField=field;
    this.lastGain=gain;
    c.drawImage(this.plate.canvas,g.left,g.top,g.w,g.h);
  }
}
