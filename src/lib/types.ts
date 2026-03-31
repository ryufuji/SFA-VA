// 共通型定義

export type Bindings = {
  DB: D1Database;
  STORAGE: R2Bucket;
}

export type AppEnv = { Bindings: Bindings }
