export type StepStatus='NOT_STARTED'|'READY'|'IN_PROGRESS'|'WAITING_EXTERNAL'|'WAITING_STUDENT'|'BLOCKED'|'COMPLETED'|'FAILED'|'WAIVED'|'CANCELLED';
const allowed: Record<StepStatus, readonly StepStatus[]> = {
  NOT_STARTED:['READY','CANCELLED'], READY:['IN_PROGRESS','BLOCKED','WAITING_EXTERNAL','WAITING_STUDENT','COMPLETED','WAIVED','CANCELLED'],
  IN_PROGRESS:['WAITING_EXTERNAL','WAITING_STUDENT','BLOCKED','COMPLETED','FAILED','CANCELLED'],
  WAITING_EXTERNAL:['READY','IN_PROGRESS','BLOCKED','FAILED','COMPLETED','CANCELLED'],
  WAITING_STUDENT:['READY','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED'],
  BLOCKED:['READY','CANCELLED'], COMPLETED:[], FAILED:['READY','CANCELLED'], WAIVED:[], CANCELLED:[]
};
export function transitionStep(from: StepStatus,to: StepStatus,prerequisitesMet:boolean,hasPermission:boolean): StepStatus {
  if(!hasPermission) throw new Error('FORBIDDEN');
  if(!allowed[from].includes(to)) throw new Error('INVALID_TRANSITION');
  if((to==='READY'||to==='COMPLETED')&&!prerequisitesMet) throw new Error('PREREQUISITE_NOT_MET');
  return to;
}
