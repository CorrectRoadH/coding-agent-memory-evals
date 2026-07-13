/** 默认对比矩阵排除明确标为 stress 的超大任务；stress 有自己的实验配置。 */
export const STANDARD_EVALS = (id: string): boolean => !id.startsWith("stress/");

export const COMMIT0_STRESS_EVALS = ["stress/commit0-cachetools"];
