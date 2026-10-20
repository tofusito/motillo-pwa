// A completed older fetch must never replace a newer month or hide its loading state.
export class LatestRequest {
 private version=0;
 private controller:AbortController|null=null;
 start(){this.controller?.abort();const controller=new AbortController(),version=++this.version;this.controller=controller;return {signal:controller.signal,current:()=>version===this.version&&!controller.signal.aborted};}
 cancel(){this.version++;this.controller?.abort();}
}
