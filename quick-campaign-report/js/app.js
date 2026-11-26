/* Quick Campaign Report: builds an Outlook-safe HTML report from email tracking figures.
   Everything runs in the browser. No figures are sent anywhere. */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const noDash=s=>String(s==null?'':s).replace(/\s*—\s*/g,', ');
const int=v=>v==null?'-':Math.round(v).toLocaleString('en-US');
const pct=(v,d)=>v==null?'-':(v*100).toFixed(d==null?2:d)+'%';
const num=v=>{if(v==null)return null;const s=String(v).replace(/[,\s%]/g,'');return s===''||isNaN(+s)?null:+s;};

/* ---------- state ---------- */
const FIELDS=[
  ['g','Send details'],
  ['campaign','Campaign name','wide'],['label','Email label (E1, E2)'],['sentDate','Date sent'],['jobId','Job ID'],
  ['subject','Subject line','wide'],
  ['g','Delivery'],
  ['sent','Total sent'],['delivered','Delivered'],['hard','Hard bounces'],['soft','Soft bounces'],['block','Block bounces'],
  ['g','Engagement'],
  ['opensUnique','Unique opens'],['opensTotal','Total opens'],['clicksUnique','Unique clicks'],['clicksTotal','Total clicks'],['unsubs','Unsubscribes'],
  ['g','Not sent (optional)'],
  ['notSent','Total not sent'],['dup','Duplicates'],['excluded','Excluded lists'],['held','Held'],['optout','Opted out'],['detective','List Detective']
];
/* Invented school and invented figures. */
const EXAMPLE={campaign:'Spring Open Day Invitation',label:'E1',sentDate:'12 Mar 2026, 10:00',jobId:'100001',
  subject:'You are invited: Spring Open Day at Example Academy',
  sent:12000,delivered:11815,hard:30,soft:150,block:5,opensUnique:4250,opensTotal:6100,clicksUnique:148,clicksTotal:210,unsubs:20,
  notSent:3200,dup:1900,excluded:950,held:180,optout:130,detective:40};
let uid=0;
const sends=[{id:++uid,d:Object.assign({},EXAMPLE),example:true,copy:null}];
let mode='individual', current=0;
const combined={copy:null};

/* ---------- metrics and status ---------- */
function M(d){
  const n=k=>num(d[k]);
  const sent=n('sent'); if(!sent) return null;
  const hard=n('hard')||0,soft=n('soft')||0,block=n('block')||0,bounces=hard+soft+block;
  let delivered=n('delivered'); if(delivered==null) delivered=sent-bounces;
  if(!delivered) return null;
  const uo=n('opensUnique'),uc=n('clicksUnique'),un=n('unsubs');
  const r=(a,b)=>a==null||!b?null:a/b;
  return {sent,delivered,hard,soft,block,bounces,uo,uc,un,
    deliv:delivered/sent,open:r(uo,delivered),click:r(uc,delivered),ctor:r(uc,uo),unsub:r(un,delivered),
    notSent:n('notSent'),
    ns:[['Duplicates',n('dup')],['Excluded lists',n('excluded')],['Held',n('held')],['Opted out',n('optout')],['List Detective',n('detective')]].filter(x=>x[1]!=null).sort((a,b)=>b[1]-a[1])};
}
const TONE={green:{c:'#1B7A4D',bg:'#E3F4EA',t:'#1B7A4D'},neutral:{c:'#1E3262',bg:'#E9EDF3',t:'#1E3262'},amber:{c:'#B97A0A',bg:'#FCF0D9',t:'#9A5B06'},red:{c:'#B0362B',bg:'#FBE6E3',t:'#B0362B'}};
const S=(label,tone)=>({label,tone});
const NA=S('N/A','neutral');
const st={
  deliv:r=>r==null?NA:r>=.98?S('HEALTHY','green'):r>=.95?S('WATCH','amber'):S('LOW','red'),
  open:r=>r==null?NA:r>=.38?S('HIGH','green'):r>=.34?S('ABOVE AVG','green'):r>=.30?S('AVERAGE','neutral'):r>=.27?S('BELOW AVG','amber'):S('LOW','red'),
  click:r=>r==null?NA:r>=.015?S('ABOVE AVG','green'):r>=.01?S('AVERAGE','neutral'):S('LOW','red'),
  ctor:r=>r==null?NA:r>=.09?S('ABOVE AVG','green'):r>=.06?S('AVERAGE','neutral'):r>=.04?S('BELOW AVG','amber'):S('LOW','red'),
  unsub:r=>r==null?NA:r<.002?S('HEALTHY','green'):r<=.005?S('WATCH','amber'):S('HIGH','red')
};
const full={'HIGH':'high','ABOVE AVG':'above average','AVERAGE':'average','BELOW AVG':'below average','LOW':'low'};
const nameOf=(s,i)=>[s.d.campaign,s.d.label].filter(Boolean).join(' ')||('Send '+(i+1));
const today=()=>new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});

/* ---------- wording from rules ---------- */
function ruleCopy(s){
  const m=M(s.d), d=s.d; if(!m) return null;
  const sd=st.deliv(m.deliv),so=st.open(m.open),sc=st.click(m.click),sr=st.ctor(m.ctor),su=st.unsub(m.unsub);
  const goodBits=[],badBits=[];
  (sd.tone==='green'?goodBits:badBits).push('delivery');
  (so.tone==='green'||so.tone==='neutral'?goodBits:badBits).push('opens');
  (sc.tone==='green'||sc.tone==='neutral'?goodBits:badBits).push('clicks');
  const list=a=>a.length>1?a.slice(0,-1).join(', ')+' and '+a[a.length-1]:a[0];
  const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
  let intro='Here is a quick summary of how the '+(d.campaign||'campaign')+' email performed. ';
  if(goodBits.length&&badBits.length) intro+=cap(list(goodBits))+(goodBits.length>1?' were':' was')+' on track, while '+list(badBits)+' came in low, so that is the main thing to improve for the next send.';
  else if(goodBits.length) intro+=cap(list(goodBits))+' were all on track.';
  else intro+=cap(list(badBits))+' all came in below where we want them.';
  const t=[];
  t.push({st:sd,bold:sd.tone==='green'?'Delivery was clean.':sd.tone==='amber'?'Delivery needs a look.':'Delivery was low.',
    text:pct(m.deliv)+' reached the inbox, with '+int(m.hard)+' hard bounce'+(m.hard===1?'':'s')+'.'});
  const cmp=so.tone==='green'?'beat':so.tone==='neutral'?'was in line with':'fell short of';
  t.push({st:so,bold:'Opens were '+(full[so.label]||'not available')+'.',text:m.open==null?'Open figures were not available.':'At '+pct(m.open)+', the open rate '+cmp+' our 30-33% average.'});
  t.push({st:sc,bold:sc.label==='LOW'?'Clicks are the weak spot.':'Clicks were '+(full[sc.label]||'not available')+'.',
    text:m.click==null?'Click figures were not available.':int(m.uc)+' people clicked ('+pct(m.click)+'), a click-to-open rate of '+pct(m.ctor)+' against an education industry average of about 7%.'});
  t.push({st:su,bold:su.tone==='green'?'Unsubscribes were low.':su.tone==='amber'?'Unsubscribes need watching.':'Unsubscribes were high.',
    text:m.un==null?'Unsubscribe figures were not available.':int(m.un)+' contacts unsubscribed ('+pct(m.unsub)+').'});
  const steps=[];
  if(sc.tone==='red'||sr.tone==='red'||sr.tone==='amber') steps.push({bold:'Strengthen the call to action'+(d.label?' for the next email':'')+'.',text:'Move it higher in the email and make it more prominent.'});
  if(m.uo!=null&&m.uc!=null&&m.uo-m.uc>0&&sc.tone!=='green'){const x=m.uo-m.uc;steps.push({bold:'Follow up with openers who did not click.',text:'That is around '+int(x>1000?Math.round(x/100)*100:x)+' contacts who showed interest.'});}
  if(so.tone==='amber'||so.tone==='red') steps.push({bold:'Test a new subject line and send time.',text:'Opens were under our 30% mark, so try a shorter, more specific subject line.'});
  if(su.tone==='amber'||su.tone==='red') steps.push({bold:'Check the audience and frequency.',text:int(m.un)+' unsubscribes suggests some contacts are getting more than they want.'});
  if(m.soft>0) steps.push({bold:'Review the '+int(m.soft)+' soft bounce'+(m.soft===1?'':'s'),text:'before the next send.'});
  if(sd.tone!=='green') steps.push({bold:'Clean the list before the next send.',text:'Remove the hard bounces and check the blocked addresses.'});
  steps.push({bold:'Repeat what worked.',text:'Keep the same subject line style for the next email in the series.'});
  steps.push({bold:'Check the Click Activity tab.',text:'See which links drew the clicks and lead with those next time.'});
  return {intro,takeaways:t,steps:steps.slice(0,3),edited:false};
}
function agg(list){
  const a={sent:0,delivered:0,hard:0,soft:0,block:0,uo:0,uc:0,un:0};
  list.forEach(x=>{const m=x.m;a.sent+=m.sent;a.delivered+=m.delivered;a.hard+=m.hard;a.soft+=m.soft;a.block+=m.block;a.uo+=m.uo||0;a.uc+=m.uc||0;a.un+=m.un||0;});
  a.bounces=a.hard+a.soft+a.block;a.deliv=a.delivered/a.sent;a.open=a.uo/a.delivered;a.click=a.uc/a.delivered;a.ctor=a.uo?a.uc/a.uo:null;a.unsub=a.un/a.delivered;
  return a;
}
function validList(){return sends.map((s,i)=>({s,i,m:M(s.d)})).filter(x=>x.m);}
function shortNames(list){
  const labels=list.map(x=>x.s.d.label||'');
  const uniq=labels.every(l=>l)&&new Set(labels).size===labels.length;
  return list.map((x,k)=>uniq?labels[k]:nameOf(x.s,x.i));
}
function ruleCopyCombined(){
  const list=validList(); if(list.length<2) return null;
  const a=agg(list), names=shortNames(list);
  const best=(k)=>list.reduce((b,x,i)=>(x.m[k]!=null&&(b<0||x.m[k]>list[b].m[k]))?i:b,-1);
  const worst=(k)=>list.reduce((b,x,i)=>(x.m[k]!=null&&(b<0||x.m[k]<list[b].m[k]))?i:b,-1);
  const bo=best('open'),wo=worst('open'),bc=best('click'),wc=worst('click'),hu=best('unsub');
  const camps=new Set(list.map(x=>x.s.d.campaign||'')); const same=camps.size===1&&[...camps][0];
  const sd=st.deliv(a.deliv),su=st.unsub(a.unsub);
  const intro='This report compares '+list.length+' sends'+(same?' of the '+same+' campaign':'')+'. '+(bo>=0&&bo===bc?names[bo]+' had the strongest opens and clicks':(bo>=0?names[bo]+' had the strongest opens':'')+(bc>=0?(bo>=0?' and ':'')+names[bc]+' the strongest clicks':''))+'.';
  const t=[];
  t.push({st:sd,bold:sd.tone==='green'?'Delivery was clean across the sends.':'Delivery needs a look.',text:pct(a.deliv)+' of '+int(a.sent)+' emails reached the inbox, with '+int(a.hard)+' hard bounces in total.'});
  if(bo>=0) t.push({st:st.open(list[bo].m.open),bold:names[bo]+' had the strongest opens.',text:'Its open rate was '+pct(list[bo].m.open)+(wo!==bo?', against '+pct(list[wo].m.open)+' for '+names[wo]:'')+'. Our average is 30-33%.'});
  if(bc>=0) t.push({st:st.click(list[bc].m.click),bold:names[bc]+' had the strongest clicks.',text:'Its click rate was '+pct(list[bc].m.click)+(wc!==bc?', against '+pct(list[wc].m.click)+' for '+names[wc]:'')+'. Click-to-open was '+pct(list[bc].m.ctor)+', against an education industry average of about 7%.'});
  t.push({st:su,bold:su.tone==='green'?'Unsubscribes were low overall.':su.tone==='amber'?'Unsubscribes need watching.':'Unsubscribes were high.',text:int(a.un)+' contacts unsubscribed in total ('+pct(a.unsub)+')'+(hu>=0?', with the highest rate on '+names[hu]+' ('+pct(list[hu].m.unsub)+')':'')+'.'});
  const steps=[];
  if(bc>=0) steps.push({bold:'Reuse what worked in '+names[bc]+'.',text:'It drew the highest click rate, so use its layout and call to action as the starting point for the next send.'});
  if(st.click(a.click).tone==='red') steps.push({bold:'Strengthen the call to action across the series.',text:'Overall clicks were '+pct(a.click)+', under our 1% mark.'});
  if(st.open(a.open).tone==='amber'||st.open(a.open).tone==='red') steps.push({bold:'Test new subject lines.',text:'Overall opens were '+pct(a.open)+', under our 30% mark.'});
  if(a.soft>0) steps.push({bold:'Review the '+int(a.soft)+' soft bounces',text:'before the next send.'});
  steps.push({bold:'Check the Click Activity tab for each send.',text:'See which links drew the clicks and lead with those next time.'});
  return {intro,takeaways:t,steps:steps.slice(0,3),edited:false};
}
function copyFor(target){
  const fresh=target===combined?ruleCopyCombined():ruleCopy(target);
  if(!target.copy||!target.copy.edited){target.copy=fresh;return fresh;}
  if(fresh) target.copy.takeaways.forEach((t,i)=>{if(fresh.takeaways[i])t.st=fresh.takeaways[i].st;});
  return target.copy;
}

/* ---------- report HTML (Outlook safe) ---------- */
const F='font-family:Arial,Helvetica,sans-serif;',X='mso-line-height-rule:exactly;';
const T=(w,inner)=>'<table role="presentation" width="'+w+'" border="0" cellpadding="0" cellspacing="0" style="width:'+w+'px;">'+inner+'</table>';
function bar(w,total,h){
  w=Math.max(0,Math.min(total,w));
  const c=(px,col)=>'<td width="'+px+'" height="'+h+'" bgcolor="'+col+'" style="width:'+px+'px;height:'+h+'px;background-color:'+col+';font-size:0;line-height:0;">&nbsp;</td>';
  return T(total,'<tr>'+(w>0?c(w,'#1E3262'):'')+(w<total?c(total-w,'#E9EDF3'):'')+'</tr>');
}
const fill=(v,max,total)=>!v||!max?0:Math.max(2,Math.round(total*v/max));
const hBand=(title,sub)=>'<tr><td bgcolor="#1E3262" style="background-color:#1E3262;padding:24px 24px 22px 24px;"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">'
  +'<tr><td style="'+F+'font-size:12px;line-height:18px;'+X+'font-weight:bold;letter-spacing:1px;color:#A9C1E8;">EMAIL CAMPAIGN REPORT</td></tr>'
  +'<tr><td style="'+F+'font-size:26px;line-height:32px;'+X+'font-weight:bold;color:#FFFFFF;padding:6px 0 8px 0;">'+esc(title)+'</td></tr>'
  +(sub?'<tr><td style="'+F+'font-size:14px;line-height:20px;'+X+'color:#D5DEEE;">'+sub+'</td></tr>':'')+'</table></td></tr>';
const para=t=>'<tr><td style="'+F+'font-size:16px;line-height:24px;'+X+'color:#222222;text-align:justify;-webkit-hyphens:none;-ms-hyphens:none;hyphens:none;word-break:normal;padding:0 0 16px 0;">'+esc(noDash(t))+'</td></tr>';
const heading=(t,note)=>'<tr><td style="'+F+'font-size:18px;line-height:24px;'+X+'font-weight:bold;color:#1E3262;padding:0 0 '+(note?4:10)+'px 0;">'+esc(t)+'</td></tr>'
  +(note?'<tr><td style="'+F+'font-size:13px;line-height:19px;'+X+'color:#5A6779;padding:0 0 12px 0;">'+esc(note)+'</td></tr>':'');
const block=(inner,pad)=>'<tr><td style="padding:0 0 '+(pad==null?24:pad)+'px 0;">'+inner+'</td></tr>';
function tile(label,value,detail,s){
  const c=TONE[s.tone].c;
  return '<td width="104" valign="top" align="center" bgcolor="#F4F6FA" style="width:104px;background-color:#F4F6FA;border-top:4px solid '+c+';padding:10px 6px 12px 6px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">'
   +'<tr><td align="center" height="32" valign="top" style="height:32px;'+F+'font-size:12px;line-height:16px;'+X+'color:#5A6779;">'+esc(label)+'</td></tr>'
   +'<tr><td align="center" style="'+F+'font-size:22px;line-height:28px;'+X+'font-weight:bold;color:#1E3262;">'+esc(value)+'</td></tr>'
   +'<tr><td align="center" style="'+F+'font-size:12px;line-height:16px;'+X+'color:#5A6779;padding:2px 0 6px 0;">'+esc(detail)+'</td></tr>'
   +'<tr><td align="center" style="'+F+'font-size:12px;line-height:16px;'+X+'font-weight:bold;color:'+c+';">'+esc(s.label)+'</td></tr></table></td>';
}
function tiles(m){
  const sp='<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>';
  return block(T(552,'<tr>'+[
    tile('Delivery rate',pct(m.deliv),int(m.delivered)+' delivered',st.deliv(m.deliv)),
    tile('Open rate',pct(m.open),int(m.uo)+' unique',st.open(m.open)),
    tile('Click rate',pct(m.click),int(m.uc)+' unique',st.click(m.click)),
    tile('Click-to-open rate',pct(m.ctor),'clicks / opens',st.ctor(m.ctor)),
    tile('Unsubscribe rate',pct(m.unsub),int(m.un)+' contacts',st.unsub(m.unsub))].join(sp)+'</tr>'));
}
function barRow(label,w,value,sub){
  return '<tr><td width="90" style="width:90px;'+F+'font-size:14px;line-height:20px;'+X+'font-weight:bold;color:#222222;padding:5px 0 5px 0;">'+esc(label)+'</td>'
   +'<td width="340" style="width:340px;padding:5px 0 5px 0;">'+bar(w,340,18)+'</td>'
   +'<td width="122" align="right" style="width:122px;'+F+'font-size:14px;line-height:20px;'+X+'color:#222222;padding:5px 0 5px 0;"><b>'+esc(value)+'</b>'+(sub?' <span style="color:#5A6779;">('+esc(sub)+')</span>':'')+'</td></tr>';
}
function box(title,big,line,rows){
  const max=rows.reduce((a,r)=>Math.max(a,r[1]||0),0);
  return '<td width="268" valign="top" style="width:268px;border:1px solid #E5E5E5;padding:14px 13px 12px 13px;">'+T(240,
    '<tr><td colspan="3" style="'+F+'font-size:16px;line-height:22px;'+X+'font-weight:bold;color:#1E3262;">'+esc(title)+'</td></tr>'
   +'<tr><td colspan="3" style="'+F+'font-size:13px;line-height:19px;'+X+'color:#5A6779;padding:2px 0 10px 0;"><span style="font-size:22px;line-height:28px;font-weight:bold;color:#222222;">'+esc(big)+'</span> &nbsp;'+esc(line)+'</td></tr>'
   +rows.map(r=>'<tr><td width="96" style="width:96px;'+F+'font-size:13px;line-height:18px;'+X+'color:#222222;padding:4px 0 4px 0;">'+esc(r[0])+'</td>'
     +'<td width="96" style="width:96px;padding:4px 0 4px 0;">'+bar(fill(r[1],max,96),96,12)+'</td>'
     +'<td width="48" align="right" style="width:48px;'+F+'font-size:13px;line-height:18px;'+X+'font-weight:bold;color:#222222;padding:4px 0 4px 0;">'+int(r[1])+'</td></tr>').join(''))+'</td>';
}
function takeaways(list){
  return block(T(552,list.map(t=>{const c=TONE[t.st.tone];
    return '<tr><td width="88" valign="top" style="width:88px;padding:5px 0 5px 0;">'+T(78,'<tr><td align="center" valign="middle" bgcolor="'+c.bg+'" style="background-color:'+c.bg+';'+F+'font-size:11px;line-height:14px;padding:5px 0 5px 0;text-align:center;vertical-align:middle;font-weight:bold;color:'+c.t+';">'+esc(t.st.label)+'</td></tr>')+'</td>'
     +'<td valign="top" style="'+F+'font-size:16px;line-height:24px;'+X+'color:#222222;padding:5px 0 5px 0;"><b>'+esc(noDash(t.bold))+'</b> '+esc(noDash(t.text))+'</td></tr>';}).join('')),20);
}
function stepRows(list){
  return block(T(552,list.map((t,i)=>'<tr><td width="38" valign="top" style="width:38px;padding:5px 0 5px 0;">'+T(26,'<tr><td align="center" valign="middle" bgcolor="#1E3262" style="background-color:#1E3262;'+F+'font-size:13px;line-height:16px;padding:4px 0 4px 0;text-align:center;vertical-align:middle;font-weight:bold;color:#FFFFFF;">'+(i+1)+'</td></tr>')+'</td>'
     +'<td valign="top" style="'+F+'font-size:16px;line-height:24px;'+X+'color:#222222;padding:5px 0 5px 0;"><b>'+esc(noDash(t.bold))+'</b> '+esc(noDash(t.text))+'</td></tr>').join('')),20);
}
const foot=t=>'<tr><td bgcolor="#F4F6FA" style="background-color:#F4F6FA;border-top:1px solid #E5E5E5;padding:12px 24px 12px 24px;'+F+'font-size:12px;line-height:18px;'+X+'color:#5A6779;">'+esc(t)+'</td></tr>';
const frame=(head,body,footer)=>'<table id="report-root" role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;border:1px solid #E5E5E5;background-color:#FFFFFF;">'+head
  +'<tr><td style="padding:24px 24px 8px 24px;">'+T(552,body)+'</td></tr>'+footer+'</table>';

function buildSingle(s){
  const m=M(s.d),d=s.d; if(!m) return null;
  const c=copyFor(s);
  const sub=[d.label,d.sentDate&&'Sent '+d.sentDate,d.jobId&&'Job ID '+d.jobId].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ');
  let b=para(c.intro);
  if(d.subject) b+=block(T(552,'<tr><td bgcolor="#F4F6FA" style="background-color:#F4F6FA;border-left:4px solid #1E3262;padding:12px 14px 12px 14px;'+F+'font-size:14px;line-height:21px;'+X+'color:#222222;"><b style="color:#1E3262;">Subject line:</b> '+esc(d.subject)+'</td></tr>'),20);
  b+=tiles(m);
  b+=heading('From send to click','Unique contacts at each stage, as a share of the '+int(m.sent)+' emails sent.');
  b+=block(T(552,barRow('Sent',340,int(m.sent),'100%')+barRow('Delivered',fill(m.delivered,m.sent,340),int(m.delivered),pct(m.deliv,1))
    +(m.uo!=null?barRow('Opened',fill(m.uo,m.sent,340),int(m.uo),pct(m.uo/m.sent,1)):'')
    +(m.uc!=null?barRow('Clicked',fill(m.uc,m.sent,340),int(m.uc),pct(m.uc/m.sent,1)):'')));
  const bRows=[['Soft bounce',m.soft],['Hard bounce',m.hard],['Block bounce',m.block]].sort((a,z)=>z[1]-a[1]);
  const hasNs=m.ns.length||m.notSent!=null;
  const nsTotal=m.notSent!=null?m.notSent:m.ns.reduce((a,r)=>a+r[1],0);
  b+=block(T(552,'<tr>'+box('Bounces',int(m.bounces),'bounced ('+pct(m.bounces/m.sent)+' of sent)',bRows)
    +'<td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td>'
    +(hasNs?box('Contacts not sent to',int(nsTotal),'held back before send',m.ns):'<td width="268" style="width:268px;font-size:0;line-height:0;">&nbsp;</td>')+'</tr>'));
  b+=heading('Key takeaways')+takeaways(c.takeaways)+heading('Suggested next steps')+stepRows(c.steps);
  return frame(hBand(d.campaign||'Campaign report',sub),b,
    foot('Source: Salesforce Marketing Cloud tracking'+(d.jobId?', Job '+d.jobId:'')+', as viewed on '+today()+'. Click-to-open rate is unique clicks divided by unique opens.'));
}
function buildCombined(){
  const list=validList().slice(0,6); if(list.length<2) return null;
  const c=copyFor(combined), a=agg(list), names=shortNames(list);
  const camps=new Set(list.map(x=>x.s.d.campaign||'')); const same=camps.size===1&&[...camps][0];
  let b=para(c.intro);
  b+=heading('All sends together')+tiles(a);
  const cw=Math.floor(420/list.length), lw=552-cw*list.length;
  const hc=(t,sub)=>'<td width="'+cw+'" align="center" valign="bottom" bgcolor="#1E3262" style="width:'+cw+'px;background-color:#1E3262;'+F+'font-size:13px;line-height:18px;'+X+'font-weight:bold;color:#FFFFFF;padding:8px 4px 8px 4px;">'+esc(t)+(sub?'<br><span style="font-weight:normal;font-size:11px;color:#D5DEEE;">'+esc(sub)+'</span>':'')+'</td>';
  const lc=t=>'<td width="'+lw+'" style="width:'+lw+'px;border-bottom:1px solid #E5E5E5;'+F+'font-size:13px;line-height:18px;'+X+'color:#222222;padding:8px 6px 8px 0;">'+esc(t)+'</td>';
  const vc=(v,s)=>'<td width="'+cw+'" align="center" style="width:'+cw+'px;border-bottom:1px solid #E5E5E5;'+F+'font-size:14px;line-height:18px;'+X+'font-weight:bold;color:#222222;padding:8px 4px 8px 4px;">'+esc(v)+(s?'<br><span style="font-size:10px;color:'+TONE[s.tone].t+';">'+esc(s.label)+'</span>':'')+'</td>';
  const row=(label,fn)=>'<tr>'+lc(label)+list.map(x=>{const r=fn(x.m);return vc(r[0],r[1]);}).join('')+'</tr>';
  b+=heading('Send by send');
  b+=block(T(552,'<tr><td width="'+lw+'" bgcolor="#1E3262" style="width:'+lw+'px;background-color:#1E3262;font-size:0;line-height:0;">&nbsp;</td>'+list.map((x,k)=>hc(names[k],x.s.d.sentDate?String(x.s.d.sentDate).split(',')[0]:'')).join('')+'</tr>'
    +row('Sent',m=>[int(m.sent)])+row('Delivered',m=>[int(m.delivered)])
    +row('Delivery rate',m=>[pct(m.deliv),st.deliv(m.deliv)])
    +row('Unique opens',m=>[int(m.uo)])+row('Open rate',m=>[pct(m.open),st.open(m.open)])
    +row('Unique clicks',m=>[int(m.uc)])+row('Click rate',m=>[pct(m.click),st.click(m.click)])
    +row('Click-to-open rate',m=>[pct(m.ctor),st.ctor(m.ctor)])
    +row('Unsubscribe rate',m=>[pct(m.unsub),st.unsub(m.unsub)])));
  const cmp=(title,k)=>{const max=list.reduce((q,x)=>Math.max(q,x.m[k]||0),0);
    return heading(title)+block(T(552,list.map((x,i)=>barRow(names[i].length>12?names[i].slice(0,11)+'.':names[i],fill(x.m[k],max,340),pct(x.m[k]))).join('')));};
  b+=cmp('Open rate by send','open')+cmp('Click rate by send','click');
  b+=heading('Key takeaways')+takeaways(c.takeaways)+heading('Suggested next steps')+stepRows(c.steps);
  const jobs=list.map(x=>x.s.d.jobId).filter(Boolean);
  return frame(hBand(same||'Combined campaign report',esc(list.length+' sends: '+names.join(', '))),b,
    foot('Source: Salesforce Marketing Cloud tracking'+(jobs.length?', Jobs '+jobs.join(', '):'')+', as viewed on '+today()+'. Totals add the sends together. Click-to-open rate is unique clicks divided by unique opens.'));
}
const docOf=(inner,title)=>'<!DOCTYPE html>\n<html lang="en" xmlns="http://www.w3.org/1999/xhtml">\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>'+esc(title)+'</title>\n</head>\n<body style="margin:0;padding:0;background-color:#FFFFFF;">\n<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;"><tr><td align="center" style="padding:20px 0 20px 0;">\n'+inner.replace(' id="report-root"','')+'\n</td></tr></table>\n</body>\n</html>';

/* ---------- UI: sends ---------- */
function warnings(s){
  const d=s.d,n=k=>num(d[k]),w=[];
  const sent=n('sent'),del=n('delivered');
  if(!sent) return 'Add the total sent to build this report.';
  const b=(n('hard')||0)+(n('soft')||0)+(n('block')||0);
  if(del!=null&&sent-b!==del) w.push('Sent minus bounces is '+int(sent-b)+', but delivered says '+int(del)+'.');
  const parts=['dup','excluded','held','optout','detective'].map(n);
  if(n('notSent')!=null&&parts.some(x=>x!=null)){const sum=parts.reduce((a,x)=>a+(x||0),0);if(sum!==n('notSent'))w.push('Not-sent reasons add up to '+int(sum)+', but total not sent says '+int(n('notSent'))+'.');}
  if(n('opensUnique')!=null&&del!=null&&n('opensUnique')>del) w.push('Unique opens are higher than delivered.');
  if(n('clicksUnique')!=null&&n('opensUnique')!=null&&n('clicksUnique')>n('opensUnique')) w.push('Unique clicks are higher than unique opens.');
  return w.join(' ');
}
function renderSends(){
  const box=$('#sends'); box.textContent='';
  if(!sends.length){const p=document.createElement('p');p.className='hint';p.style.marginTop='12px';p.textContent='No sends yet. Add a send to start.';box.appendChild(p);}
  sends.forEach((s,i)=>{
    const card=document.createElement('div');card.className='send';
    const head=document.createElement('div');head.className='send-head';
    const nm=document.createElement('div');nm.className='send-name';nm.textContent=nameOf(s,i);head.appendChild(nm);
    if(s.example){const chip=document.createElement('span');chip.className='pill';chip.textContent='Example';head.appendChild(chip);}
    const rm=document.createElement('button');rm.className='btn ghost small';rm.textContent='Remove';rm.id='remove-'+s.id;
    rm.addEventListener('click',()=>{sends.splice(sends.indexOf(s),1);current=0;refresh(true);});head.appendChild(rm);
    card.appendChild(head);
    const grid=document.createElement('div');grid.className='grid';
    const wr=document.createElement('div');wr.className='warns';wr.textContent=warnings(s);
    FIELDS.forEach(f=>{
      if(f[0]==='g'){const g=document.createElement('div');g.className='grp';g.textContent=f[1];grid.appendChild(g);return;}
      const lab=document.createElement('label');lab.className='fld'+(f[2]?' wide':'');
      const sp=document.createElement('span');sp.textContent=f[1];
      const inp=document.createElement('input');inp.type='text';inp.id='f-'+s.id+'-'+f[0];inp.value=s.d[f[0]]==null?'':s.d[f[0]];
      if(!f[2]&&['label','sentDate','jobId'].indexOf(f[0])<0) inp.inputMode='numeric';
      inp.addEventListener('input',()=>{s.d[f[0]]=inp.value;nm.textContent=nameOf(s,sends.indexOf(s));wr.textContent=warnings(s);renderReport();});
      lab.appendChild(sp);lab.appendChild(inp);grid.appendChild(lab);
    });
    card.appendChild(grid);card.appendChild(wr);
    box.appendChild(card);
  });
}

/* ---------- UI: report ---------- */
function target(){return mode==='combined'?combined:(validList()[current]||{}).s;}
function currentHtml(){
  if(mode==='combined') return buildCombined();
  const v=validList()[current]; return v?buildSingle(v.s):null;
}
function renderReport(){
  const list=validList();
  if(list.length<2) mode='individual';
  if(current>=list.length) current=0;
  $('#mode-row').hidden=list.length<2;
  $('#mode-ind').setAttribute('aria-pressed',mode==='individual');
  $('#mode-com').setAttribute('aria-pressed',mode==='combined');
  const tabs=$('#tabs');tabs.textContent='';tabs.hidden=mode==='combined';
  list.forEach((x,k)=>{const b=document.createElement('button');b.id='tab-'+x.s.id;b.textContent=nameOf(x.s,x.i);b.setAttribute('aria-pressed',k===current);b.addEventListener('click',()=>{current=k;refresh(false);});tabs.appendChild(b);});
  const html=currentHtml(), pv=$('#preview');
  /* Every value in the report string is escaped by esc() before it is joined in. */
  if(html) pv.innerHTML=html; else pv.innerHTML='<div class="empty">Add a send with at least the total sent to see the report here.</div>';
  ['#copy-rich','#dl-html','#print-pdf','#copy-code','#reset-copy'].forEach(id=>{$(id).disabled=!html;});
}
function renderWording(){
  const box=$('#wording');box.textContent='';
  const t=target(); if(!t||!currentHtml()) return;
  const c=t.copy; if(!c) return;
  const mk=(labelText,value,id,area,on)=>{const lab=document.createElement('label');lab.className='fld';const sp=document.createElement('span');sp.textContent=labelText;
    const inp=document.createElement(area?'textarea':'input');if(!area)inp.type='text';inp.id=id;inp.value=value;
    inp.addEventListener('input',()=>{on(inp.value);c.edited=true;renderReport();});lab.appendChild(sp);lab.appendChild(inp);return lab;};
  box.appendChild(mk('Intro',c.intro,'w-intro',true,v=>c.intro=v));
  c.takeaways.forEach((x,i)=>{const p=document.createElement('div');p.className='pair';
    p.appendChild(mk('Takeaway '+(i+1)+' headline',x.bold,'w-t'+i+'-b',false,v=>x.bold=v));
    p.appendChild(mk('Detail',x.text,'w-t'+i+'-t',false,v=>x.text=v));box.appendChild(p);});
  c.steps.forEach((x,i)=>{const p=document.createElement('div');p.className='pair';
    p.appendChild(mk('Next step '+(i+1)+' headline',x.bold,'w-s'+i+'-b',false,v=>x.bold=v));
    p.appendChild(mk('Detail',x.text,'w-s'+i+'-t',false,v=>x.text=v));box.appendChild(p);});
}
function refresh(rebuildSends){ if(rebuildSends) renderSends(); renderReport(); renderWording(); }
const say=t=>{$('#status').textContent=t;};
function fileBase(){
  if(mode==='combined'){const l=validList();const c=l[0]&&l[0].s.d.campaign;return (c||'Campaign').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-Combined-Report';}
  const v=validList()[current];return nameOf(v.s,v.i).replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-Report';
}
function reportTitle(){
  if(mode==='combined') return 'Combined campaign report';
  const v=validList()[current]; return 'Campaign Report: '+nameOf(v.s,v.i);
}

/* ---------- events ---------- */
$('#add-send').addEventListener('click',()=>{
  for(let i=sends.length-1;i>=0;i--) if(sends[i].example&&JSON.stringify(sends[i].d)===JSON.stringify(EXAMPLE)) sends.splice(i,1);
  sends.push({id:++uid,d:{},copy:null}); refresh(true);
  const first=$('#f-'+uid+'-campaign'); if(first) first.focus();
});
$('#load-example').addEventListener('click',()=>{sends.push({id:++uid,d:Object.assign({},EXAMPLE),example:true,copy:null});refresh(true);});
$('#mode-ind').addEventListener('click',()=>{mode='individual';refresh(false);});
$('#mode-com').addEventListener('click',()=>{mode='combined';refresh(false);});
$('#reset-copy').addEventListener('click',()=>{const t=target();if(t){t.copy=null;refresh(false);say('Wording reset.');}});

$('#copy-rich').addEventListener('click',async()=>{
  const el=$('#report-root'); if(!el) return;
  const done='Copied. Paste it into your Outlook email with Ctrl+V.';
  try{
    await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([el.outerHTML.replace(' id="report-root"','')],{type:'text/html'}),'text/plain':new Blob([el.innerText],{type:'text/plain'})})]);
    say(done);
  }catch(e){
    const r=document.createRange();r.selectNode(el);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);
    let ok=false;try{ok=document.execCommand('copy');}catch(_){}
    sel.removeAllRanges();
    say(ok?done:'Your browser blocked the copy. Use Download HTML instead.');
  }
});
$('#copy-code').addEventListener('click',async()=>{
  const html=currentHtml(); if(!html) return;
  try{await navigator.clipboard.writeText(docOf(html,reportTitle()));say('HTML code copied.');}catch(e){say('Your browser blocked the copy. Use Download HTML instead.');}
});
$('#dl-html').addEventListener('click',()=>{
  const html=currentHtml(); if(!html) return;
  const url=URL.createObjectURL(new Blob([docOf(html,reportTitle())],{type:'text/html'}));
  const a=document.createElement('a');a.href=url;a.download=fileBase()+'-Outlook.html';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  say('Saved '+a.download+'.');
});
$('#print-pdf').addEventListener('click',()=>{
  const html=currentHtml(); if(!html) return;
  const old=document.getElementById('print-frame'); if(old) old.remove();
  const fr=document.createElement('iframe');fr.id='print-frame';fr.title='Report for printing';
  fr.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  fr.addEventListener('load',()=>{try{fr.contentWindow.focus();fr.contentWindow.print();say('In the print window, choose "Save as PDF" as the printer. Turn on "Background graphics" so the colours print.');}catch(e){say('Printing was blocked. Use Download HTML, then print that file.');}});
  fr.srcdoc=docOf(html,reportTitle()).replace('</head>','<style>@page{margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head>');
  document.body.appendChild(fr);
});

refresh(true);
})();
