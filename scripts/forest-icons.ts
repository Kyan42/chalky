import type { Block, Shape } from '../lib/blocks/types';
const path=(d:string,fill?:string,stroke='green'):Shape=>({type:'path',d,fill,stroke,width:1.4});
const ellipse=(cx:number,cy:number,rx:number,ry:number,fill:string,stroke='green'):Shape=>({type:'ellipse',cx,cy,rx,ry,fill,stroke,width:1.4});
const block=(id:string,title:string,shapes:Shape[]):Block=>({id,title,describe:title,tags:['forest','illustration'],size:[100,100],parts:[{id:'illustration',label:title,shapes}],anchors:{center:[50,50]}});
const trunk=()=>path('M45 88 L47 43 L54 43 L57 88 Z','brown-tint','brown');
const pine=(x:number,y:number,s:number):Shape=>path(`M${x} ${y} l${-15*s} ${24*s} h${8*s} l${-14*s} ${22*s} h${13*s} l${-15*s} ${22*s} h${46*s} l${-15*s} ${-22*s} h${13*s} l${-14*s} ${-22*s} h${8*s} Z`,'green-tint');
export const FOREST_ICONS:Block[]=[
block('forest-oak','Old oak',[trunk(),path('M48 58 C31 68 16 58 20 46 C7 35 20 20 31 24 C33 7 57 9 62 19 C81 12 92 28 82 39 C96 56 75 67 62 59 Z','green-tint'),path('M51 65 L34 48 M52 58 L69 43',undefined,'brown')]),
block('forest-pine','Pine tree',[trunk(),pine(50,8,1)]),
block('forest-birch','Birch tree',[ellipse(49,34,29,28,'green-tint'),path('M43 90 L46 33 L53 30 L58 90 Z','white','brown'),path('M46 47 L51 48 M51 59 L55 58 M44 73 L49 72 M52 83 L57 82',undefined,'brown')]),
block('forest-grove','Forest grove',[path('M8 90 Q50 80 92 90',undefined,'brown'),path('M24 84 L24 43 M74 85 L74 43',undefined,'brown'),pine(25,15,.62),pine(75,13,.66),path('M48 91 L48 58 L54 58 L54 91 Z','brown-tint','brown'),ellipse(51,48,24,29,'green-tint')]),
block('forest-sapling','New sapling',[path('M24 87 Q50 78 77 87',undefined,'brown'),path('M50 84 Q46 59 54 30',undefined,'green'),path('M49 61 C23 65 18 43 21 35 C42 34 52 47 49 61 Z','green-tint'),path('M51 45 C49 25 65 16 82 17 C81 35 68 49 51 45 Z','green-tint')]),
block('forest-fern','Fern',[path('M47 90 Q48 54 65 12',undefined,'green'),...Array.from({length:5},(_,i)=>{const y=75-i*12,x=49+i*2;return path(`M${x} ${y} Q${x-27} ${y+2} ${x-28} ${y-14} Q${x-8} ${y-16} ${x} ${y} M${x} ${y} Q${x+25} ${y-1} ${x+29} ${y-18} Q${x+9} ${y-18} ${x} ${y}`,'green-tint');})]),
block('forest-mushroom','Woodland mushroom',[path('M40 85 L45 48 L56 48 L62 85 Q52 93 40 85 Z','brown-tint','brown'),path('M12 51 C18 5 79 5 88 51 Q51 66 12 51 Z','red-tint','red'),ellipse(34,37,5,4,'white','red'),ellipse(58,28,6,4,'white','red'),ellipse(72,45,4,3,'white','red'),path('M20 88 L16 78 M23 88 L28 79 M77 88 L81 77',undefined,'green')]),
block('computer-podium','Computer on a podium',[path('M25 65 L73 65 L78 93 L20 93 Z','brown-tint','brown'),path('M16 60 L82 60 L86 67 L13 67 Z','yellow-tint','brown'),path('M24 12 L77 12 L77 49 L24 49 Z','blue-tint','blue'),path('M29 17 L72 17 L72 43 L29 43 Z','blue-tint','blue'),path('M46 49 L55 49 L56 56 L65 59 L36 59 L45 56 Z','brown-tint','brown'),path('M36 25 L32 29 L36 33 M64 25 L68 29 L64 33 M54 23 L47 36',undefined,'white')])
];
