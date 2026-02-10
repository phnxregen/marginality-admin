import{o as f,p as y,q as x,t as g,r as i,_ as S,v as a,n as e,M as w,L as j,O as M,S as k}from"./components-RfMRA6_q.js";/**
 * @remix-run/react v2.17.3
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */let l="positions";function O({getKey:o,...c}){let{isSpaMode:p}=f(),r=y(),h=x();g({getKey:o,storageKey:l});let m=i.useMemo(()=>{if(!o)return null;let t=o(r,h);return t!==r.key?t:null},[]);if(p)return null;let u=((t,d)=>{if(!window.history.state||!window.history.state.key){let s=Math.random().toString(32).slice(2);window.history.replaceState({key:s},"")}try{let n=JSON.parse(sessionStorage.getItem(t)||"{}")[d||window.history.state.key];typeof n=="number"&&window.scrollTo(0,n)}catch(s){console.error(s),sessionStorage.removeItem(t)}}).toString();return i.createElement("script",S({},c,{suppressHydrationWarning:!0,dangerouslySetInnerHTML:{__html:`(${u})(${a(JSON.stringify(l))}, ${a(JSON.stringify(m))})`}}))}const v="/assets/tailwind-BZjvUeSM.css",L=()=>[{rel:"preconnect",href:"https://fonts.googleapis.com"},{rel:"preconnect",href:"https://fonts.gstatic.com",crossOrigin:"anonymous"},{rel:"stylesheet",href:"https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"},{rel:"stylesheet",href:v}];function N(){return e.jsxs("html",{lang:"en",children:[e.jsxs("head",{children:[e.jsx("meta",{charSet:"utf-8"}),e.jsx("meta",{name:"viewport",content:"width=device-width, initial-scale=1"}),e.jsx(w,{}),e.jsx(j,{})]}),e.jsxs("body",{className:"flex flex-col min-h-screen text-slate-700 bg-slate-100",children:[e.jsx(M,{}),e.jsx(O,{}),e.jsx(k,{})]})]})}export{N as default,L as links};
