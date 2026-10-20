import type {Analytics} from './analytics';
export type Period = 'valle'|'llano'|'punta';
export type Rates = {mode?:'periods'|'flat'|'pvpc';hourly?:Record<string,number>;updatedAt?:string;month:string;valle:number|null;llano:number|null;punta:number|null;taxIncluded:boolean;source:string};
export type Settings = {powerEntity:string;energyEntity:string;plugEntity:string;thresholdW:number;endDelayMinutes:number;holidays:string[];referenceChargeKwh?:number|null};
export type EntityOption = {id:string;name:string;unit:string;kind:'power'|'energy'|'plug'};
export type Session = {id:number;startedAt:string;endedAt:string|null;energyKwh:number;costEur:number|null;unpricedKwh:number;durationMinutes:number;peakW:number;averageW:number;quality:'measured'|'estimated'|'incomplete';periods:Record<Period,number>;savingEur:number|null};
export type Dashboard = {
 analytics:Analytics;
 month:string;availableMonths:string[];settings:Settings;rates:Rates|null;
 live:{status:'unconfigured'|'offline'|'idle'|'charging';powerW:number|null;plugOn:boolean|null;updatedAt:string|null;activeSession:Session|null;period:Period;rate:number|null;message:string};
 summary:{energyKwh:number;costEur:number|null;unpricedKwh:number;sessionCount:number;averageSessionKwh:number;averageSessionCostEur:number|null;savingEur:number|null;chargingHours:number;coverageStart:string|null};
 sessions:Session[];
 daily:{date:string;energyKwh:number;costEur:number|null}[];
 hourly:{hour:number;energyKwh:number;costEur:number|null}[];
 periods:{period:Period;energyKwh:number;costEur:number|null}[];
 insights:{title:string;detail:string;tone:'info'|'good'|'warning'}[];
};
