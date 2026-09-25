export type Window={start:string;end:string};
export function overlaps(a:Window,b:Window):boolean {
  const [as,ae,bs,be]=[a.start,a.end,b.start,b.end].map(Date.parse);
  if([as,ae,bs,be].some(Number.isNaN)||as>=ae||bs>=be) throw new Error('INVALID_WINDOW');
  return as<be&&bs<ae;
}
export function candidateAvailable(candidate:Window, studentLessons:readonly Window[],resourceBookings:readonly Window[],resourceBlocks:readonly Window[]):boolean {
  return ![...studentLessons,...resourceBookings,...resourceBlocks].some(window=>overlaps(candidate,window));
}
