export interface Rule { selector: string; line: number; decls: { prop: string; value: string }[] }
export interface Problem { line?: number; selector: string; why: string }
export declare function rules(text: string): Rule[];
export declare function expandSelectors(selector: string): string[];
export declare function checkMotion(all: Rule[]): Problem[];
export declare function checkStates(all: Rule[]): Problem[];
export declare function checkCraft(all: Rule[]): Problem[];
