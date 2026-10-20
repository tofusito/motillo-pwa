import type {Period} from './model';
export type Analytics = {
 reference:{energyKwh:number|null;source:'manual'|'sessions'|'daily-history'|'unset';sampleCount:number};
 comparison:{valleEur:number|null;llanoEur:number|null;puntaEur:number|null;differenceEur:number|null;nightSavingPercent:number|null;taxIncluded:boolean|null};
 live:{activeCostEur:number|null;estimatedTotalEur:number|null;remainingKwh:number|null;remainingMinutes:number|null;reason:'available'|'idle'|'stale'|'missing-reference'|'reference-exceeded'|'missing-rate'|'incomplete'|'mixed-tax';rateMonth:string;scenario:'current-rate';taxIncluded:boolean|null};
 stats:{completedSessionCount:number;pricedSessionCount:number;averageKwh:number|null;averageCostEur:number|null;averageDurationMinutes:number|null;averagePriceEurKwh:number|null;savingVsPuntaEur:number|null;avoidableCostVsValleEur:number|null;taxBasis:'included'|'excluded'|'mixed'|'unknown'};
 sessions:{id:number;valleyEur:number|null;puntaEur:number|null;avoidableEur:number|null;savedVsPuntaEur:number|null}[];
 trend:{month:string;sessionCount:number;energyKwh:number|null;costEur:number|null;taxBasis:'included'|'excluded'|'mixed'|'unknown'}[];
 tariff:{nextChangeAt:string;nextPeriod:Period;nextValleAt:string;valleEndsAt:string};
};
