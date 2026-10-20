export type HistoricalDay = {date:string;energyKwh:number;costMinEur:number|null;costMaxEur:number|null;rateMonth:string|null;pricing:'monthly'|'reference'|'missing';taxIncluded:boolean|null;valleyOnly:boolean;recordedAt:string};
export type HistoricalHistory = {
 month:string;days:HistoricalDay[];availableMonths:string[];totalEnergyKwh:number;costMinEur:number|null;costMaxEur:number|null;unpricedKwh:number;referenceRateMonth:string|null;
 fetchedAt:string|null;status:'ready'|'pending'|'unavailable';message:string;
};
export type HistoricalHour = {startedAt:string;recordedAt:string;energyKwh:number;costEur:number|null;rateMonth:string|null;pricing:'monthly'|'reference'|'missing';taxIncluded:boolean|null};
export type HourlyHistory = {
 month:string;points:HistoricalHour[];availableMonths:string[];
 summary:{energyKwh:number;costEur:number|null;unpricedKwh:number;knownHours:number;count:number};
 source:'meross-hourly';status:'ready'|'pending'|'unavailable';fetchedAt:string|null;referenceRateMonth:string|null;
 taxBasis:'included'|'excluded'|'mixed'|'unknown';message:string;
};
