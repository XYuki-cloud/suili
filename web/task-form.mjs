import { dateAdd, startOfWeek, packPlan } from '../shared/core.mjs';

function checkedDate(value,label){
 if(!value)throw new Error(`请选择${label}。`);
 try{return dateAdd(value,0);}catch{throw new Error(`${label}无效，请重新选择。`);}
}

/** UI switches resolve into the existing independent deadline/plan fields. */
export function taskTiming({hasDeadline=false,deadline='',allocateTime=false,kind='none',start='',end='',segments=[]}) {
 const due=hasDeadline?checkedDate(deadline,'截止日期'):null;
 if(hasDeadline&&!allocateTime||kind==='none')return {deadline:due,plan:{kind:'none',start:null,end:null}};
 if(kind==='segments')return {deadline:due,plan:packPlan(segments)};
 if(!['day','week','range'].includes(kind))throw new Error('请选择有效的日期安排。');
 start=checkedDate(start,'开始日期');
 if(kind==='week'){start=startOfWeek(start);end=dateAdd(start,6);}
 else if(kind==='day')end=start;
 else{end=checkedDate(end,'结束日期');if(end<start)throw new Error('结束日期不能早于开始日期。');}
 return {deadline:due,plan:{kind,start,end}};
}
