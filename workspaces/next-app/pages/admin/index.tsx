// 老代码:/admin 这块历史上用的是 Pages Router(而非 App Router)。
// selective-forgetting-scope 用它来检验「全局迁 App Router、但 /admin 豁免」这条带例外的记忆。
export default function AdminHome() {
  return <div>Admin (legacy Pages Router)</div>;
}
