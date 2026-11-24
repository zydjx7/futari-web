// Local, registered ink surfaces for the passes between the six original
// wash drawings. Coordinates are native texels, with the same ground in all
// drawings. Each shared triangle edge is sampled once (half-open scanlines).
const size=384;
const keys=[null,"wash1_lift","wash2_paws","wash3_cheekUp","wash4_cheekDown",
  "wash5_earReach","wash6_earStroke","wash_earMid"];
export const earMid=keys[7];
const clamp01=x=>Math.max(0,Math.min(1,x));

function context(){
  const c=document.createElement("canvas");c.width=c.height=size;
  return c.getContext("2d",{willReadFrequently:true});
}
function compressedMask([x,y,w,h,code]){
  const s=atob(code),out=new Uint8Array(w*h);
  for(let i=0,n=0;i<s.length;){
    const t=s.charCodeAt(i++);
    if(t<128){for(let j=0;j<=t;j++)out[n++]=s.charCodeAt(i++);}
    else {const count=257-t;out.fill(s.charCodeAt(i++),n,n+count);n+=count;}
  }
  return {x,y,w,h,out};
}
function masked(source,mask){
  const {x,y,w,h,out:coverage}=compressedMask(mask);
  const width=w+4,height=h+4,data=new Uint8ClampedArray(width*height*4);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const at=4*((y+j)*size+x+i),a=coverage[j*w+i]/255;
    const dest=4*((j+2)*width+i+2);
    for(let k=0;k<4;k++)data[dest+k]=source[at+k]*a;
  }
  return {pixels:data,width,height,x:x-2,y:y-2};
}
function associated(data){
  const out=new Uint8ClampedArray(data);
  for(let i=0;i<out.length;i+=4){
    const a=out[i+3]/255;
    if(a<1){out[i]*=a;out[i+1]*=a;out[i+2]*=a;}
  }
  return out;
}
function canvasPixels(c){return associated(c.getImageData(0,0,size,size).data);}
function layPalm(coat,palm){
  const {pixels,width,height,x,y}=palm;
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    const s=4*(j*width+i),d=4*((j+y)*size+x+i),under=1-pixels[s+3]/255;
    if(under===1)continue;
    for(let k=0;k<4;k++)coat[d+k]=pixels[s+k]+under*coat[d+k];
  }
}
function closeEyes(out,open,closed,t){
  // Both lids live on the very same face. Register the oval onto the curve
  // inside each eye window; never blend two skulls to close an eye.
  for(const [x,y] of [[106,161],[208,158]]){
    const width=6.5+5.4*t,height=11.1-9.2*t;
    for(let j=-15;j<=15;j++)for(let i=-18;i<=18;i++){
      const u=i/width,arc=2.0-3.5*Math.min(1,u*u);
      const v=(j-t*arc)/height;
      const at=4*((y+j)*size+x+i);
      const lx=x+Math.max(-18,Math.min(18,6.5*u)),ly=y+Math.max(-15,Math.min(15,11.1*v));
      const rx=x+Math.max(-18,Math.min(18,11.9*u)),ry=y+Math.max(-15,Math.min(15,1.9*v+arc));
      const blend=clamp01((18-Math.abs(i))/3)*clamp01((15-Math.abs(j))/3);
      for(let k=0;k<3;k++){
        const base=open[at+k]*(1-t)+closed[at+k]*t;
        out[at+k]=base+blend*((1-t)*sampleChannel(open,lx,ly,k)+t*sampleChannel(closed,rx,ry,k)-base);
      }
    }
  }
}

function seatedCoat(source){
  const out=new Uint8ClampedArray(source);
  // The front painting contains the two *front* feet on the floor. Rebuild
  // the little strip of belly that they uncover, carrying the original floor
  // pencil from the adjoining flank. The broad hindfeet then take the weight.
  for(let x=80;x<209;x++){
    const u=clamp01((x-80)/18)*clamp01((209-x)/12);
    const floor=374.5-13*Math.exp(-(x-80)/27);
    const donorX=220+(x%24);let last=382;
    while(last>345&&source[4*(last*size+donorX)+3]<128)last--;
    for(let y=344;y<384;y++){
      const w=u*clamp01((y-344)/8);if(!w)continue;
      const i=4*(y*size+x),dy=y-floor;
      const sy=Math.min(383,Math.max(0,Math.round(last+dy)));
      const ground=4*(sy*size+donorX),fur=4*((320+(y%15))*size+x);
      const edge=clamp01((dy+5)/3),alpha=dy>1?0:source[ground+3];
      for(let k=0;k<3;k++){
        const rgb=alpha?source[ground+k]*edge+source[fur+k]*(1-edge):0;
        out[i+k]+=w*(rgb-out[i+k]);
      }
      out[i+3]+=w*(alpha-out[i+3]);
    }
  }
  return out;
}
// Invert the registered crown-to-heel displacement on both intact coats.
// The paws remain separate throughout the rise and the return to the floor.
function soleDistance(im){
  const field=new Float32Array(size*size);field.fill(30);
  const solid=i=>im[4*i+3]>127;
  for(let y=286;y<size-1;y++)for(let x=1;x<size-1;x++){
    const i=y*size+x,s=solid(i);
    if(s!==solid(i-1)||s!==solid(i+1)||s!==solid(i-size)||s!==solid(i+size))
      field[i]=Math.abs(im[4*i+3]/255-.5);
  }
  for(const sign of [1,-1])for(let j=286;j<size-1;j++)for(let k=1;k<size-1;k++){
    const i=(sign>0?j:286+382-j)*size+(sign>0?k:383-k);
    field[i]=Math.min(field[i],1+field[i-sign],1+field[i-sign*size],
      1.414+field[i-sign*size-1],1.414+field[i-sign*size+1]);
  }
  for(let i=286*size;i<field.length;i++)if(!solid(i))field[i]*=-1;
  return field;
}
const heelX=149,heelY=311,heelStart=1.56,heelStep=.006;
function sampleChannel(src,x,y,ch){
  const xx=x|0,yy=y|0,f=x-xx,g=y-yy,n=4*(yy*size+xx)+ch;
  return (1-g)*(src[n]+f*(src[n+4]-src[n]))+g*(src[n+4*size]+f*(src[n+4*size+4]-src[n+4*size]));
}
// The near cheek meets the shoulder at a corner. On the two bending-ear
// paintings this corner sits at different heights, even though the feet agree.
function shoulderX(pixels,y){
  const row=4*y*size+3;
  for(let x=26;x<82;x++){
    const alpha=pixels[row+4*x];
    if(alpha>=128){
      const prev=pixels[row+4*(x-1)];
      return x-1+(127.5-prev)/(alpha-prev);
    }
  }
  return 82;
}
function uncoverShoulder(out,coat,t){
  // A passing wrist can briefly cover the same outside stroke with its soft
  // root. Restore its original pencil only at the currently exposed edge.
  const pass=clamp01(Math.min(t,1-t)/.08);
  for(let y=224;y<=256;y++){
    const edge=shoulderX(out,y),donor=shoulderX(coat,y);
    const fade=pass*clamp01((y-224)/5)*clamp01((256-y)/5);
    for(let x=Math.floor(edge);x<=edge+3.6;x++){
      const dst=4*(y*size+x),a=out[dst+3],sx=donor+x-edge,inkAlpha=sampleChannel(coat,sx,y,3);
      if(a<90||inkAlpha<80)continue;
      const weight=fade*clamp01((3.6-x+edge)/1.3);
      for(let c=0;c<3;c++){
        const ink=sampleChannel(coat,sx,y,c)*a/inkAlpha;
        out[dst+c]+=weight*Math.min(0,ink-out[dst+c]);
      }
    }
  }
}
function heelRim(coat){
  const radii=new Float32Array(272);
  for(let i=0;i<radii.length;i++){
    const a=heelStart+i*heelStep,x=Math.cos(a),y=Math.sin(a);
    let lo=0,hi=170;
    for(let n=0;n<12;n++){
      const r=(lo+hi)*.5,py=heelY+r*y;
      if(py<382 && sampleChannel(coat,heelX+r*x,py,3)>127)lo=r;else hi=r;
    }
    radii[i]=(lo+hi)*.5;
  }
  return radii;
}
function paintHeel(out,from,to,t,rims){
  // Retract the rounded hind toe into the flank along the same polar rays.
  // Registering the two painted rims also carries their fur and AA inwards.
  // A simple intersection of two sole masks would sharpen the toe into a wedge.
  for(let y=319;y<382;y++)for(let x=32;x<141;x++){
    const dx=x-heelX,dy=y-heelY,r=Math.hypot(dx,dy),ux=dx/r,uy=dy/r;
    const pos=(Math.atan2(dy,dx)-heelStart)/heelStep,n=pos|0,u=pos-n;
    if(n<1||n>=rims[0].length-2)continue;
    const a=rims[0][n]*(1-u)+rims[0][n+1]*u,b=rims[1][n]*(1-u)+rims[1][n+1]*u;
    const depth=a+(b-a)*t-r;
    const mix=clamp01((140-x)/13)*clamp01((y-319)/12)*clamp01((34-depth)/14);
    if(!mix)continue;
    const d=4*(y*size+x);
    if(depth< -2){for(let k=0;k<4;k++)out[d+k]*=1-mix;continue;}
    const lx=heelX+(a-depth)*ux,ly=Math.min(382.99,heelY+(a-depth)*uy);
    const rx=heelX+(b-depth)*ux,ry=Math.min(382.99,heelY+(b-depth)*uy);
    for(let k=0;k<4;k++){
      const value=(1-t)*sampleChannel(from,lx,ly,k)+t*sampleChannel(to,rx,ry,k);
      out[d+k]+=mix*(value-out[d+k]);
    }
  }
}
function landFrontToe(out,moving,seated,settle){
  // As the front paw touches down it covers the retracting heel. Register
  // both actual bottom edges before the last small contact correction so a
  // low-alpha copy of the pencil cannot remain below the grounded paw.
  function floor(plate,x){
    let y=382;while(y>=337 && plate[4*(y*size+x)+3]<128)y--;
    if(y<337)return null;
    const at=4*(y*size+x),a=plate[at+3],b=plate[at+size*4+3];
    return y+clamp01((a-127.5)/Math.max(1,a-b));
  }
  for(let x=53;x<149;x++){
    const a=floor(moving,x),b=floor(seated,x);if(a===null||b===null)continue;
    const ground=a+(b-a)*settle;
    for(let y=Math.max(337,Math.floor(ground-14));y<Math.min(384,Math.ceil(Math.max(a,b)+4));y++){
      const weight=clamp01((x-53)/10)*clamp01((149-x)/9)*clamp01((y-ground+14)/8);
      const l=Math.max(0,Math.min(382.999,y+a-ground)),r=Math.max(0,Math.min(382.999,y+b-ground));
      const n=4*(y*size+x),alpha=(1-settle)*sampleChannel(moving,x,l,3)+settle*sampleChannel(seated,x,r,3);
      const old=out[n+3],cover=old+weight*(alpha-old);
      for(let k=0;k<3;k++){
        const ink=(1-settle)*sampleChannel(moving,x,l,k)+settle*sampleChannel(seated,x,r,k);
        out[n+k]=cover>0?((1-weight)*old*out[n+k]+weight*255*ink)/cover:0;
      }
      out[n+3]=cover;
    }
  }
}
function seatedBody(out,from,to,t,step,grids,soles,shoulder){
  const u=1-t,cols=size/step+1,at=t*(grids.length-1);
  const index=Math.min(grids.length-2,at|0),v=at-index,ga=grids[index],gb=grids[index+1];
  const field=new Float32Array(ga.length),A=soles[0],B=soles[1];
  for(let i=0;i<field.length;i++)field[i]=.5*(ga[i]+v*(gb[i]-ga[i]));
  for(let y=2;y<size;y++){
    const r=(y/step|0)*cols,f=y%step/step;
    const q=shoulder?clamp01((y+u*shoulder[1]-225)/54):1;
    const mesh=q*q*(3-2*q),sx=(1-mesh)*(shoulder?.[0]??0),sy=(1-mesh)*(shoulder?.[1]??0);
    for(let x=24;x<354;x+=step){
      const lo=2*(r+x/step),hi=lo+2*cols;
      let dx=field[lo]*(1-f)+field[hi]*f,dy=field[lo+1]*(1-f)+field[hi+1]*f;
      const ix=(field[lo+2]*(1-f)+field[hi+2]*f-dx)/step,iy=(field[lo+3]*(1-f)+field[hi+3]*f-dy)/step;
      for(let j=0;j<step;j++,dx+=ix,dy+=iy){
        const col=x+j,vx=sx+mesh*dx,vy=sy+mesh*dy;
        const lx=Math.max(0,Math.min(382.999,col-t*vx)),ly=Math.max(0,Math.min(382.999,y-t*vy));
        const rx=Math.max(0,Math.min(382.999,col+u*vx)),ry=Math.max(0,Math.min(382.999,y+u*vy));
        const l=4*((ly|0)*size+(lx|0)),r=4*((ry|0)*size+(rx|0)),row=4*size,d=4*(y*size+col);
        if(!(from[l+3]|from[l+7]|from[l+row+3]|from[l+row+7]|to[r+3]|to[r+7]|to[r+row+3]|to[r+row+7]))continue;
        const fx=lx-(lx|0),fy=ly-(ly|0),gx=rx-(rx|0),gy=ry-(ry|0);
        const la=u*(1-fx)*(1-fy),lb=u*fx*(1-fy),lc=u*(1-fx)*fy,ld=u*fx*fy;
        const ra=t*(1-gx)*(1-gy),rb=t*gx*(1-gy),rc=t*(1-gx)*gy,rd=t*gx*gy;
        for(let k=0;k<4;k++){
          const a=l+k,b=r+k;
          out[d+k]=la*from[a]+lb*from[a+4]+lc*from[a+row]+ld*from[a+row+4]+
            ra*to[b]+rb*to[b+4]+rc*to[b+row]+rd*to[b+row+4];
        }
        if(y>310){
          const ia=l/4,ib=r/4;
          const depth=la*A[ia]+lb*A[ia+1]+lc*A[ia+size]+ld*A[ia+size+1]+
            ra*B[ib]+rb*B[ib+1]+rc*B[ib+size]+rd*B[ib+size+1];
          // The left hindfoot travels out from behind the seated animal. Its
          // interior is opaque even when just one donor covers it. Keeping
          // the pigment at the donor weight punched a triangle inside the rim.
          if(depth>-1 && (depth<4 || (col<141 && out[d+3]<255))){
            const old=out[d+3],alpha=255*clamp01(.5+depth);
            // Both the interior and the feathered edge use the current fur.
            // Retain the approved rounding at partially covered toe pixels.
            const edge=clamp01((2.6-depth)/1.5)*clamp01(18*Math.min(t,u));
            for(let k=0;k<3;k++){
              const fur=255*out[d+k]/Math.max(1,old);
              out[d+k]=alpha*((1-edge)*out[d+k]/Math.max(1,old)+edge*fur/255);
            }
            out[d+3]=alpha;
          }else if(depth<=-1)out.fill(0,d,d+4);
        }
      }
    }
  }
}
function jawAt(path,fraction){
  const x=path[0][0]+(path.at(-1)[0]-path[0][0])*fraction;
  let j=1;while(j<path.length-1 && path[j][0]<x)j++;
  const [a,b]=path[j-1],[c,d]=path[j];
  return b+(d-b)*(x-a)/(c-a);
}

// A normal stretch of the guide should move the line without changing the
// pressure of the crayon. Correct only the exposed cream-to-coat boundary.
// All key paintings, hands, alpha coverage and the original two orbits bypass it.
function registeredPencil(pixels,book,from,to,t){
  if(!book?.cheeks || t<.012 || t>.988)return;
  const src=book.cheeks[from||"idle"],dst=book.cheeks[to||"idle"];
  const seated=!from||!to;
  const lum=(x,y)=>{
    const n=4*(Math.round(y)*size+x);
    return .2126*pixels[n]+.7152*pixels[n+1]+.0722*pixels[n+2];
  };
  for(let side=0;side<2;side++){
    const a=src[side],b=dst[side];
    const l=Math.ceil(a[0][0]*(1-t)+b[0][0]*t),r=Math.floor(a.at(-1)[0]*(1-t)+b.at(-1)[0]*t);
    const expected=new Float32Array(r-l+1),center=expected.slice(),valid=new Uint8Array(expected.length);
    for(let x=l;x<=r;x++){const u=(x-l)/(r-l);expected[x-l]=(1-t)*jawAt(a,u)+t*jawAt(b,u);}
    // Seated and raised jaws are at quite different heights near the handoff.
    let offset=0,best=-Infinity;const search=seated?19:6;
    for(let dy=-search;dy<=search;dy++){
      let score=0;
      for(let x=l;x<=r;x+=3){
        const y=expected[x-l]+dy;
        score+=Math.max(0,167-lum(x,y))*clamp01((lum(x,y-7)-177)/26)*clamp01((lum(x,y+7)-147)/20);
      }
      score-=Math.abs(dy)*.2;
      if(score>best){offset=dy;best=score;}
    }
    for(let x=l;x<=r;x++){
      const j=x-l,y=expected[j]+offset;
      let inkY=Math.round(y),best=Infinity;
      for(let k=Math.round(y)-7;k<=Math.round(y)+7;k++){
        const v=lum(x,k)+.27*(k-y)**2;
        if(v<best){best=v;inkY=k;}
      }
      let mass=0,first=0;
      for(let k=inkY-2;k<=inkY+2;k++){const w=Math.max(0,146-lum(x,k));mass+=w;first+=k*w;}
      center[j]=mass?first/mass:y;
      valid[j]=lum(x,inkY)<145 && lum(x,inkY-7)>192 && lum(x,inkY+7)>151 && lum(x,inkY-7)-lum(x,inkY+7)>10;
    }
    const widths=[];
    for(let j=3;j<center.length-3;j++){
      if(!valid[j])continue;
      const x=l+j,y=Math.round(center[j]);let u=y,v=y;
      while(u>y-8&&lum(x,u)<150)u--;while(v<y+8&&lum(x,v)<150)v++;
      if(v===y||u===y||u===y-8||v===y+8)continue;
      const top=u+(lum(x,u)-150)/Math.max(.1,lum(x,u)-lum(x,u+1));
      const bottom=v-(lum(x,v)-150)/Math.max(.1,lum(x,v)-lum(x,v-1));
      widths.push((bottom-top)/Math.hypot(1,(center[j+3]-center[j-3])/6));
    }
    if(widths.length<10)continue;
    widths.sort((x,y)=>x-y);
    const width=widths[widths.length>>1],target=width>3.4?3.12:3.18;
    const gain=Math.max(-.27,Math.min(.31,width/target-1));
    if(Math.abs(gain)<.018)continue;
    const column=new Uint8ClampedArray(17*4);
    for(let j=2;j<center.length-2;j++){
      if(!(valid[j-1]&&valid[j]&&valid[j+1]))continue;
      const x=l+j,mid=center[j],start=Math.round(mid)-8;
      for(let k=0;k<17;k++){
        const at=4*((start+k)*size+x);
        for(let ch=0;ch<3;ch++)column[4*k+ch]=pixels[at+ch];
      }
      for(let k=2;k<15;k++){
        const y=start+k,d=y-mid,at=4*(y*size+x);
        if(pixels[at+3]<254)continue;
        const s=k+gain*d*clamp01((6.3-Math.abs(d))/3.3),lo=Math.floor(s),f=s-lo;
        for(let ch=0;ch<3;ch++)pixels[at+ch]=column[4*lo+ch]*(1-f)+column[4*(lo+1)+ch]*f;
      }
    }
  }
}
function coord(p){return new Float32Array(p.flat());}
function fan(n){return Array.from({length:n-1},(_,i)=>[0,i+1,(i+1)%(n-1)+1]);}
function strip(n){
  const out=[];
  for(let i=0;i<n-2;i+=2)out.push([i,i+1,i+2],[i+1,i+3,i+2]);
  return out;
}
// Label contiguous runs instead of tracing triangles a second time. Only
// rendered islands outside the coat and enclosed holes can be repaired here.
function topologyWorkspace(){
  return Object.fromEntries(["start","end","labels","parent","kind"].map(key=>[key,new Uint16Array(8192)]));
}
function continuousCoat(pixels,work,recheck=true,threshold=45){
  const {start,end,labels,parent,kind}=work;
  let count=0,prev=0,heart=0;
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let y=0;y<size;y++){
    const row=count;let above=prev;
    for(let x=0;x<size;){
      const l=x,inside=pixels[4*(y*size+x)+3]>threshold;
      do{x++;}while(x<size && (pixels[4*(y*size+x)+3]>threshold)===inside);
      const id=count++;start[id]=l;end[id]=x;kind[id]=inside;labels[id]=y;parent[id]=id;
      if(y===240 && l<=165 && x>165)heart=id;
      if(!y)continue;
      while(above<row && end[above]<=l)above++;
      for(let j=above;j<row && start[j]<x;j++)if(kind[j]===kind[id])parent[root(id)]=root(j);
    }
    prev=row;
  }
  const main=root(heart),paper=root(0);let fixed=false;
  for(let j=0;j<count;j++){
    const live=root(j);if(live===main||live===paper)continue;
    fixed=true;
    const y=labels[j],l=start[j],r=end[j];
    if(kind[j]){pixels.fill(0,4*(y*size+l),4*(y*size+r));continue;}
    if(threshold===0)continue;
    // Sample the warm side underneath a lifted ear, rather than carrying the
    // narrow dark rim across the reopening contact.
    for(let x=l;x<r;x++){
      const out=4*(y*size+x);let src=out;
      for(let d=1;d<24;d++){src=4*(y*size+Math.max(0,l-d));if(pixels[src+3]>242 && pixels[src+1]>125)break;}
      // At the left shoulder the warm, opaque donor is on the right.
      if(pixels[src+3]<=242 || pixels[src+1]<=125){
        for(let col=r;col<size;col++){
          const nearby=4*(y*size+col);
          if(pixels[nearby+3]>242 && pixels[nearby+1]>125){src=nearby;break;}
        }
      }
      for(let k=0;k<3;k++)pixels[out+k]=pixels[src+k];
      pixels[out+3]=255;
    }
  }
  // An isolated pigment fleck inside a filled aperture becomes a one-texel
  // hole when removed. Reclassify only the few frames on which we repaired ink.
  if(fixed&&recheck)continuousCoat(pixels,work,false);
}
function linearPoints(a,b,t){
  const d=new Float32Array(a.length);
  for(let i=0;i<d.length;i++)d[i]=a[i]+(b[i]-a[i])*t;
  return d;
}
function sweep(a,b,t,hand){
  const p=a.uv,q=b.uv;
  const [[ax,ay],[atx,aty]]=a.axis,[[bx,by],[btx,bty]]=b.axis;
  const first=Math.atan2(aty-ay,atx-ax),last=Math.atan2(bty-by,btx-bx);
  const delta=Math.atan2(Math.sin(last-first),Math.cos(last-first));
  const ca=Math.cos(t*delta),sa=Math.sin(t*delta),cb=Math.cos((t-1)*delta),sb=Math.sin((t-1)*delta);
  // Track the actual tip, not the wrist pivot. On the rise the elbows
  // tuck outward, so the left paw never travels through the right paw.
  const arc=Math.sin(Math.PI*t)*Math.min(1,Math.hypot(btx-atx,bty-aty)/65);
  const cx=atx+(btx-atx)*t+hand*7*arc,cy=aty+(bty-aty)*t-2*arc,d=new Float32Array(p.length);
  const al=Math.hypot(atx-ax,aty-ay),bl=Math.hypot(btx-bx,bty-by);
  const vx=cx+((ax-atx)*ca-(ay-aty)*sa)*(1-t)+((bx-btx)*cb-(by-bty)*sb)*t;
  const vy=cy+((ax-atx)*sa+(ay-aty)*ca)*(1-t)+((bx-btx)*sb+(by-bty)*cb)*t;
  const ex=ax+(bx-ax)*t-vx,ey=ay+(by-ay)*t-vy;
  const tuck=Math.max(0,1-8/Math.max(8,Math.hypot(ex,ey)));
  // The elbow may slide in the chest fur, but the rounded palm never turns
  // edge-on or folds into its own wrist as its direction reverses.
  const length=Math.max(1,Math.hypot(vx-cx,vy-cy)),ux=(vx-cx)/length,uy=(vy-cy)/length;
  const along=Math.max(-.18*length,Math.min(.22*length,tuck*(ux*ex+uy*ey)));
  const across=Math.max(-.22*length,Math.min(.22*length,tuck*(ux*ey-uy*ex)));
  const mx=along*ux-across*uy,my=along*uy+across*ux;
  const inset=hand<0?Math.max(0,Math.min(9,62-vx-mx)):Math.min(0,Math.max(-9,281-vx-mx));
  for(let i=0;i<d.length;i+=2){
    const x=p[i]-atx,y=p[i+1]-aty,u=q[i]-btx,v=q[i+1]-bty;
    const heel=clamp01((1-t)*(x*(ax-atx)+y*(ay-aty))/(al*al)+t*(u*(bx-btx)+v*(by-bty))/(bl*bl));
    d[i]=cx+(1-t)*(ca*x-sa*y)+t*(cb*u-sb*v)+heel*mx+arc*inset;
    d[i+1]=cy+(1-t)*(sa*x+ca*y)+t*(sb*u+cb*v)+heel*my;
  }
  return d;
}

// Bilinear, coverage-weighted paint from two anatomically corresponding
// locations. The two paws and the pinna each have a separate moving mesh.
function raster(out,a,b,d,faces,t,over){
  const left=a.pixels,right=b.pixels,u=1-t;
  const aw=a.width||size,bw=b.width||size,ah=a.height||size,bh=b.height||size;
  const al=a.x||0,at=a.y||0,bl=b.x||0,bt=b.y||0,arow=aw*4,brow=bw*4;
  for(const tri of faces){
    const i=tri[0]*2,j=tri[1]*2,k=tri[2]*2;
    const x0=d[i],y0=d[i+1],x1=d[j],y1=d[j+1],x2=d[k],y2=d[k+1];
    const ex=x1-x0,ey=y1-y0,fx=x2-x0,fy=y2-y0,det=ex*fy-ey*fx;
    if(Math.abs(det)<.001)continue;
    const dxU=fy/det,dxV=-ey/det,dyU=-fx/det,dyV=ex/det;
    const m=a.uv,n=b.uv;
    const ax=m[j]-m[i],ay=m[j+1]-m[i+1],bx=m[k]-m[i],by=m[k+1]-m[i+1];
    const cx=n[j]-n[i],cy=n[j+1]-n[i+1],gx=n[k]-n[i],gy=n[k+1]-n[i+1];
    const axx=dxU*ax+dxV*bx, ayx=dxU*ay+dxV*by, bxx=dxU*cx+dxV*gx, byx=dxU*cy+dxV*gy;
    for(let y=Math.max(0,Math.ceil(Math.min(y0,y1,y2)));y<Math.min(size,Math.ceil(Math.max(y0,y1,y2)));y++){
      let xmin=1e6,xmax=-1e6;
      if((y0<=y&&y<y1)||(y1<=y&&y<y0)){const z=x0+(y-y0)*ex/ey;xmin=z;xmax=z;}
      if((y1<=y&&y<y2)||(y2<=y&&y<y1)){const z=x1+(y-y1)*(x2-x1)/(y2-y1);xmin=Math.min(xmin,z);xmax=Math.max(xmax,z);}
      if((y2<=y&&y<y0)||(y0<=y&&y<y2)){const z=x0+(y-y0)*fx/fy;xmin=Math.min(xmin,z);xmax=Math.max(xmax,z);}
      const from=Math.max(0,Math.ceil(xmin-1e-6)),end=Math.min(size,Math.ceil(xmax-1e-6));
      const s=(from-x0)*dxU+(y-y0)*dyU,v=(from-x0)*dxV+(y-y0)*dyV;
      let lx=m[i]+s*ax+v*bx,ly=m[i+1]+s*ay+v*by;
      let rx=n[i]+s*cx+v*gx,ry=n[i+1]+s*cy+v*gy;
      for(let x=from;x<end;x++,lx+=axx,ly+=ayx,rx+=bxx,ry+=byx){
        const px=Math.max(0,Math.min(aw-1.0001,lx-al)),py=Math.max(0,Math.min(ah-1.0001,ly-at));
        const qx=Math.max(0,Math.min(bw-1.0001,rx-bl)),qy=Math.max(0,Math.min(bh-1.0001,ry-bt));
        const li=4*((py|0)*aw+(px|0)),ri=4*((qy|0)*bw+(qx|0));
        const l1=px-(px|0),l2=py-(py|0),r1=qx-(qx|0),r2=qy-(qy|0);
        const la=(1-l1)*(1-l2)*u,lb=l1*(1-l2)*u,lc=(1-l1)*l2*u,ld=l1*l2*u;
        const ra=(1-r1)*(1-r2)*t,rb=r1*(1-r2)*t,rc=(1-r1)*r2*t,rd=r1*r2*t;
        const dst=4*(y*size+x);
        const alpha=la*left[li+3]+lb*left[li+7]+lc*left[li+arow+3]+ld*left[li+arow+7]+
          ra*right[ri+3]+rb*right[ri+7]+rc*right[ri+brow+3]+rd*right[ri+brow+7];
        if(alpha<.5)continue;
        const under=over?1-alpha/255:0;
        for(let ch=0;ch<3;ch++){
          const l=li+ch,r=ri+ch;
          out[dst+ch]=under*out[dst+ch]+la*left[l]+lb*left[l+4]+lc*left[l+arow]+ld*left[l+arow+4]+
            ra*right[r]+rb*right[r+4]+rc*right[r+brow]+rd*right[r+brow+4];
        }
        out[dst+3]=alpha+under*out[dst+3];
      }
    }
  }
}

const earRoot=[205.4,90.7], earLength=81;
const foldStops={4:0,7:.78,5:.88,6:1};
const earAcross=[.902,.432], earAlong=[.432,-.902];
export const foldStop=i=>foldStops[i];
function earPoint(s,w,p){
  const smooth=q=>{q=clamp01(q);return q*q*(3-2*q);};
  const angle=q=>p*(1.36+1.70*smooth(q/.95));
  // Integrate a bent centreline by arc length. Transport its cross-section
  // with the tangent, so even the sideways silhouette keeps a rounded tip.
  const hinge=angle(0),sn=Math.sin(hinge),cs=Math.cos(hinge);
  // Pivot inside the seated temple so the underside follows its round cheek.
  const hingeX=177,hingeY=86;
  let cx=hingeX+(earRoot[0]-hingeX)*cs-(earRoot[1]-hingeY)*sn;
  let cy=hingeY+(earRoot[0]-hingeX)*sn+(earRoot[1]-hingeY)*cs;
  for(let z=0;z<s;z+=3){
    const ds=Math.min(3,s-z),a=angle((z+ds/2)/earLength);
    cx+=ds*(earAlong[0]*Math.cos(a)-earAlong[1]*Math.sin(a));
    cy+=ds*(earAlong[0]*Math.sin(a)+earAlong[1]*Math.cos(a));
  }
  if(s<0){cx+=s*(earAlong[0]*cs-earAlong[1]*sn);cy+=s*(earAlong[0]*sn+earAlong[1]*cs);}
  const q=clamp01(s/earLength),a=angle(q),width=w*(1-.19*p*smooth(q/.5));
  return [cx+width*(earAcross[0]*Math.cos(a)-earAcross[1]*Math.sin(a)),
    cy+width*(earAcross[0]*Math.sin(a)+earAcross[1]*Math.cos(a))];
}
function palmTransform(p,tip){
  const ear=earPoint(78,0,p),u=clamp01(p/.78),reach=u*u*(3-2*u);
  const angle=reach*(2.82-.33*p),c=Math.cos(angle),s=Math.sin(angle);
  const x=tip[0]+reach*(ear[0]-12-27*clamp01((1-p)/.22)-tip[0])-6*Math.sin(Math.PI*u);
  const y=tip[1]+reach*(ear[1]-7-tip[1]);
  return [c,s,x-c*tip[0]+s*tip[1],y-s*tip[0]-c*tip[1]];
}
function surfaceQuad(layer){
  const x=layer.x,y=layer.y,r=x+layer.width-1,b=y+layer.height-1;
  return new Float32Array([x,y,r,y,x,b,r,b]);
}
// Paint one exposure. Shared edges are half-open; overlapping sections are
// visited from root to tip so a curled ear naturally occludes its underside.
function texture(out,src,d,faces,depth){
  const uv=src.uv,im=src.pixels,w=src.width,h=src.height;
  for(const [a,b,c] of faces){
    const i=2*a,j=2*b,k=2*c,x0=d[i],y0=d[i+1];
    const ax=d[j]-x0,ay=d[j+1]-y0,bx=d[k]-x0,by=d[k+1]-y0,det=ax*by-ay*bx;
    if(Math.abs(det)<.001)continue;
    for(let y=Math.max(0,Math.ceil(Math.min(y0,d[j+1],d[k+1])));y<Math.min(size,Math.ceil(Math.max(y0,d[j+1],d[k+1])));y++){
      let lo=Infinity,hi=-Infinity;
      for(const [u,v] of [[i,j],[j,k],[k,i]]){
        if((d[u+1]<=y && y<d[v+1])||(d[v+1]<=y && y<d[u+1])){
          const x=d[u]+(y-d[u+1])*(d[v]-d[u])/(d[v+1]-d[u+1]);
          lo=Math.min(lo,x);hi=Math.max(hi,x);
        }
      }
      for(let x=Math.max(0,Math.ceil(lo-1e-6));x<Math.min(size,Math.ceil(hi-1e-6));x++){
        const u=((x-x0)*by-(y-y0)*bx)/det,v=(ax*(y-y0)-ay*(x-x0))/det;
        const sx=uv[i]+u*(uv[j]-uv[i])+v*(uv[k]-uv[i])-src.x;
        const sy=uv[i+1]+u*(uv[j+1]-uv[i+1])+v*(uv[k+1]-uv[i+1])-src.y;
        if(sx<0||sy<0||sx>=w-1||sy>=h-1)continue;
        const ix=Math.floor(sx),iy=Math.floor(sy),s=4*(iy*w+ix),n=4*(y*size+x);
        const fx=sx-ix,fy=sy-iy;
        const read=k=>(1-fy)*((1-fx)*im[s+k]+fx*im[s+4+k])+fy*((1-fx)*im[s+4*w+k]+fx*im[s+4*w+4+k]);
        const alpha=read(3);
        if(alpha<.5)continue;
        const under=1-alpha/255;
        if(depth)depth[n/4]=(sx+src.x-earRoot[0])*earAlong[0]+(sy+src.y-earRoot[1])*earAlong[1];
        for(let ch=0;ch<3;ch++)out[n+ch]=read(ch)+under*out[n+ch];
        out[n+3]=alpha+(1-alpha/255)*out[n+3];
      }
    }
  }
}
function earGrid(p){
  const points=[];
  for(let s=-40;s<=92;s+=3)for(const w of [-52,52])points.push(...earPoint(s,w,p));
  return new Float32Array(points);
}
export function foldLayers(whole,back,right,left){
  const ear={x:147,y:8,width:122,height:137,uv:earGrid(0)};
  ear.pixels=new Uint8ClampedArray(ear.width*ear.height*4);
  // Reflect the hidden basal fibres from the same ear. Sampling across the
  // join continuously avoids picking up the forehead in the mobile texture.
  for(let y=ear.y;y<ear.y+ear.height;y++)for(let x=ear.x;x<ear.x+ear.width;x++){
    const u=(x-earRoot[0])*earAcross[0]+(y-earRoot[1])*earAcross[1];
    const v=(x-earRoot[0])*earAlong[0]+(y-earRoot[1])*earAlong[1];
    if(v<=-35 || Math.abs(u)>44)continue;
    let sx=x,sy=y;
    if(v<12){
      const radius=Math.sqrt(1-(Math.min(0,v)/35)**2),z=12+.47*(12-v);
      sx=earRoot[0]+z*earAlong[0]+u/radius*earAcross[0];
      sy=earRoot[1]+z*earAlong[1]+u/radius*earAcross[1];
    }
    if(sx<158||sx>263||sy<4||sy>124)continue;
    const a=sampleChannel(whole,sx,sy,3),b=sampleChannel(back,sx,sy,3);
    if(a<=b)continue;
    const dst=4*((y-ear.y)*ear.width+x-ear.x),coverage=(a-b)/Math.max(1,255-b);
    for(let ch=0;ch<3;ch++)ear.pixels[dst+ch]=sampleChannel(whole,sx,sy,ch)*255/a*coverage;
    ear.pixels[dst+3]=255*coverage;
  }
  const fixed=back.slice();layPalm(fixed,left);
  const down=whole.slice();layPalm(down,right);layPalm(down,left);
  return {surface:new Uint8ClampedArray(whole.length),depth:new Float32Array(size*size),ear,earFaces:strip(ear.uv.length/2),right:{...right,uv:surfaceQuad(right)},fixed,down};
}
export function drawFold(out,layers,p){
  if(p===0){out.set(layers.down);return;}
  out.set(layers.fixed);
  const {surface,depth}=layers;
  surface.fill(0);
  texture(surface,layers.ear,earGrid(p),layers.earFaces,depth);
  for(let y=6;y<205;y++)for(let x=134;x<312;x++){
    const i=y*size+x,n=4*i,a=surface[n+3]/255;
    if(!a)continue;
    const b=out[n+3]/255,q=clamp01((depth[i]-15)/25),front=q*q*(3-2*q);
    // Interpolate depth order at the turn. Coverage is the union in either
    // order. A partially covered crown pixel must never become a dark seam.
    for(let k=0;k<3;k++)out[n+k]=out[n+k]*(1-front*a)+surface[n+k]*(1-(1-front)*b);
    out[n+3]=255*(b+a*(1-b));
  }
  paintFoldPalm(out,layers.right,p);
}
function paintFoldPalm(out,paw,p){
  const [c,s,dx,dy]=palmTransform(p,paw.axis[1]),dest=paw.uv.slice();
  for(let i=0;i<dest.length;i+=2){
    const x=paw.uv[i],y=paw.uv[i+1];dest[i]=c*x-s*y+dx;dest[i+1]=s*x+c*y+dy;
  }
  texture(out,paw,dest,[[0,1,2],[1,3,2]]);
}
export function straightPixels(data,out){
  for(let n=0;n<data.length;n+=4){
    const a=data[n+3],gain=a?255/a:0;
    for(let k=0;k<3;k++)out[n+k]=data[n+k]*gain;
    out[n+3]=a;
  }
}
export function bakeFoldStops(whole,back,down,spec){
  const paws=['right','left'].map(k=>({...masked(associated(down),spec[k].mask),axis:spec[k].axis}));
  const layers=foldLayers(associated(whole),associated(back),...paws);
  return [7,5,6].map(i=>{
    const out=new Uint8ClampedArray(whole.length),straight=out.slice();
    drawFold(out,layers,foldStop(i));straightPixels(out,straight);
    continuousCoat(straight,topologyWorkspace());return straight;
  });
}

export class GroomBridge {
  constructor(rig,seatedSource,rubCoat,portraitPixels){
    this.rig=rig;this.seatedSource=seatedSource;this.rubCoat=rubCoat;this.book=rig.extra.groom.bridges;this.cache=new Map();
    this.output=context();this.buffer=this.output.createImageData(size,size);
    this.flat=new Uint8ClampedArray(size*size*4);
    this.portraitPixels=portraitPixels;
    this.topology=topologyWorkspace();
  }
  painting(index){
    const c=context(),base=index===7?4:index;
    c.drawImage(this.rig.extra.image,...this.rig.parts[keys[base]],0,0,size,size);
    if(index===7)this.patch(c,"mid");
    return c;
  }
  swatches(){
    if(this.ink)return this.ink;
    const ink=this.rig.extra.layerImage||this.rig.extra.image;
    const sheet=context();sheet.canvas.width=ink.width;sheet.canvas.height=ink.height;
    sheet.drawImage(ink,0,0);
    const pixels=new Uint32Array(sheet.getImageData(0,0,ink.width,ink.height).data.buffer);
    // Decode contact paint separately so filtering a small sleeping or running
    // rabbit can only ever sample its original atlas. A canvas round-trip
    // gives semi-transparent pencil tips the same alpha rounding as the coats.
    const raw=atob(this.book.ink),width=256,rows=Math.ceil(raw.length/(4*width));
    const strip=context();strip.canvas.width=width;strip.canvas.height=rows;
    const literal=strip.createImageData(width,rows);
    for(let i=0;i<raw.length;i++)literal.data[i]=raw.charCodeAt(i);
    strip.putImageData(literal,0,0);
    const newInk=new Uint32Array(strip.getImageData(0,0,width,rows).data.buffer);
    strip.canvas.width=strip.canvas.height=1;
    this.ink={};
    for(const [name,rows] of Object.entries(this.book.edits)){
      const paint=new Uint32Array(rows.reduce((n,r)=>n+r[2]*r[3],0));
      let offset=0;
      for(const [,,w,h,sx,sy] of rows)for(let j=0;j<h;j++,offset+=w){
        if(sx===-1)continue;
        const bank=sx>=0?pixels:newInk;
        const src=sx>=0?(sy+j)*ink.width+sx:-2-sx+j*sy;
        paint.set(bank.subarray(src,src+w),offset);
      }
      this.ink[name]=paint;
    }
    sheet.canvas.width=sheet.canvas.height=1;
    return this.ink;
  }
  patch(c,key){
    const ink=this.swatches()[key],im=c.getImageData(0,0,size,size),out=new Uint32Array(im.data.buffer);
    let src=0,x0=size,y0=size,x1=0,y1=0;
    for(const [x,y,w,h] of this.book.edits[key]){
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+w);y1=Math.max(y1,y+h);
      for(let j=0;j<h;j++,src+=w)out.set(ink.subarray(src,src+w),(y+j)*size+x);
    }
    if(x1>x0)c.putImageData(im,0,0,x0,y0,x1-x0,y1-y0);
  }
  plate(index){
    if(this.cache.has(index))return this.cache.get(index);
    if(index===0){
      const whole=this.seatedSource(),spec=this.book.poses.idle;
      const body=this.book.headTravel?this.portraitPixels("body",0):whole;
      const result={whole,coat:{uv:coord(spec.coat.xy),pixels:seatedCoat(body)}};
      for(const name of ["left","right"])
        result[name]={uv:coord(spec[name].xy),axis:spec[name].axis,...masked(whole,spec[name].mask)};
      this.cache.set(index,result);return result;
    }
    const spec=this.book.poses[keys[index]],sheet=this.painting(index),whole=canvasPixels(sheet);
    const coat=context();coat.drawImage(this.rubCoat(),0,0);
    if(index===1)this.patch(coat,"open");
    const result={whole,coat:{uv:coord(spec.coat.xy),pixels:canvasPixels(coat)}};
    if(index===1 && this.book.headTravel){
      this.patch(coat,"liftTorso");
      result.torso=canvasPixels(coat);
    }
    for(const name of ["left","right"]){
      if(!spec[name])continue;
      const loc={uv:coord(spec[name].xy),axis:spec[name].axis};
      if(index===3){
        // Pick the exact accepted wrist wash, including its feathered root.
        const piece=this.rig.motionPiece(name),tmp=context();tmp.drawImage(piece.canvas,piece.x,piece.y);
        result[name]={...loc,pixels:canvasPixels(tmp)};
      }else{
        result[name]={...loc,...masked(whole,spec[name].mask)};
        if(index===2){
          // Bring the licking pose to the mouth on the registered, still head.
          const palm=result[name];palm.y-=7;
          palm.axis=loc.axis.map(([x,y])=>[x,y-7]);
          for(let i=1;i<palm.uv.length;i+=2)palm.uv[i]-=7;
        }
      }
    }
    if(index!==3){
      result.whole=result.coat.pixels.slice();
      layPalm(result.whole,result.right);layPalm(result.whole,result.left);
      if(index===4){
        result.upright=result.coat;
        this.patch(coat,"earBacking");
        result.coat={uv:result.upright.uv,pixels:canvasPixels(coat)};
      }
    }
    this.cache.set(index,result);return result;
  }
  renderFold(phase){
    const plate=this.plate(4);
    if(!this.foldLayers)this.foldLayers=foldLayers(plate.upright.pixels,plate.coat.pixels,plate.right,plate.left);
    drawFold(this.flat,this.foldLayers,phase);
    straightPixels(this.flat,this.buffer.data);
    continuousCoat(this.buffer.data,this.topology);
    this.output.putImageData(this.buffer,0,0);
  }
  prime(pass){
    const a=this.plate(1),b=this.plate(4),t=.36+.28*pass;
    const src=a.coat,dst=b.upright,faces=this.book.tri["1/4"];
    raster(this.flat,src,dst,linearPoints(src.uv,dst.uv,t),faces.slice(pass*12,pass*12+12),t,false);
  }
  render(a,b,t){
    let i=keys.indexOf(a),j=keys.indexOf(b),faces=this.book.tri[i+"/"+j];
    if(i!==j && !faces){[i,j]=[j,i];t=1-t;faces=this.book.tri[i+"/"+j];}
    if(this.lastI===i && this.lastJ===j && this.lastT===t)return this.output.canvas;
    if(i>=4 && j>=4){
      const phase=foldStop(i)+(foldStop(j)-foldStop(i))*t;
      this.renderFold(phase);
      this.lastI=i;this.lastJ=j;this.lastT=t;
      return this.output.canvas;
    }
    const start=this.plate(i),end=this.plate(j),data=this.flat;
    const same=i===j,locked=i>=1 && i<=4 && j>=1 && j<=4;
    const seatPhase=clamp01(t/.915);
    const seatTravel=seatPhase*seatPhase*(3-2*seatPhase);
    const from=i===4?start.upright:start.coat,to=j===4?end.upright:end.coat;
    if(same)data.set(start.whole);
    else if(locked){
      data.set(i===1?to.pixels:from.pixels);
      if(i===1){
        if(this.book.headTravel){
          data.set(start.torso);
          layPalm(data,{pixels:this.portraitPixels("head",1,t),x:0,y:0,width:size,height:size});
        }else closeEyes(data,from.pixels,to.pixels,t);
      }
    }else if(i===0 && seatTravel===1){
      data.set(to.pixels);
    }else if(i===0){
      data.fill(0);
      const [step,encoded]=this.book.rise;
      this.seatGrids??=encoded.map(bits=>Int8Array.from(atob(bits),ch=>ch.charCodeAt(0)));
      const torso=end.torso??to.pixels;
      this.soles??=[soleDistance(from.pixels),soleDistance(torso)];
      seatedBody(data,from.pixels,torso,seatTravel,step,this.seatGrids,this.soles,this.book.shoulderTravel);
      this.heels??=[heelRim(from.pixels),heelRim(torso)];
      paintHeel(data,from.pixels,torso,seatTravel,this.heels);
      if(this.book.headTravel)
        layPalm(data,{pixels:this.portraitPixels("head",seatTravel),x:0,y:0,width:size,height:size});
    }
    for(const name of same?[]:["right","left"]){
      const l=start[name],r=end[name],dest=sweep(l,r,t,name==="left"?-1:1);
      raster(data,l,r,dest,fan(dest.length/2),t,true);
    }
    if(i===3 && j===4)uncoverShoulder(data,to.pixels,t);
    // At contact, restore the source's exact subpixel ink. Both surfaces
    // already have the same registration here; the correction is very local.
    const border=Math.min(t,1-t),source=t<.5?start:end;
    const correction=!same && !locked && border<.075?1-clamp01(border/.075)**2*(3-2*clamp01(border/.075)):0;
    const out=this.buffer.data;
    for(let n=0;n<data.length;n+=4){
      const residual=correction && (source===start?i:j)!==3 && (!this.book.headTravel || n>=4*size*305)?correction:0;
      const alpha=data[n+3]+residual*(source.whole[n+3]-data[n+3]);
      out[n+3]=alpha;
      if(alpha<.5){out[n]=out[n+1]=out[n+2]=0;continue;}
      const k=255/alpha;
      for(let ch=0;ch<3;ch++)out[n+ch]=k*(data[n+ch]+residual*(source.whole[n+ch]-data[n+ch]));
    }
    if(i===0 && t>0 && t<.075)landFrontToe(out,data,start.whole,correction);
    continuousCoat(out,this.topology);
    // The seated-to-lift displacement can leave a detached translucent
    // tip below the opaque-hole threshold. Keep the connected fringe.
    if(i===0 && !same && seatTravel>0 && seatTravel<1)
      continuousCoat(out,this.topology,false,0);
    if(!this.book.headTravel && !locked && !same && !(i===0 && seatTravel===1))registeredPencil(out,this.book,keys[i],keys[j],i===0?seatTravel:t);
    this.output.putImageData(this.buffer,0,0);this.lastI=i;this.lastJ=j;this.lastT=t;
    return this.output.canvas;
  }
}
