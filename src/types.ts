export interface Groups{
    title: string,
    description: string,
    guidLine: GuideLine [],
}

export interface GuideLine{
    type: string,
    title: string,
    description: string,
    weight: string,
    score: string,
    status: string,
    item: Item[]
}

export interface Item{
    snippet: string,
    explanation: string,
}


export enum Status {
    Pass = 'Pass',
    Fail = 'Fail',
}
