# 上游规范审查

当前源码：personal.quota-manager v0.1.6，目标宿主 CPR v3.36.0。使用公开 ZCard 指标卡与 ZTag 会员标签，配色和样式取自共享组件。

## 依据

- [RS Issue #278](https://github.com/zyycn/codex-proxy-rs/issues/278)：自定义业务采用插件；UI 库用于组件和主题一致性；plugins 仓库提供可运行示例。不要求把示例集合安装为运行时依赖。
- RS v3.36.0，提交 `5ae38dc0c55c192815ef605dde6c05fd767a2c28` 的 `.agents/skills/cpr-plugin-dev`、公开 SDK 及宿主桥契约。
- [UI v0.4.1 安装说明](https://github.com/zyycn/codex-proxy-ui/blob/v0.4.1/playground/guide/installation.md)，当前源码参考 `1496e21637e7e80e87c7f75387e27ced5029187a`。
- [plugins/workbench](https://github.com/zyycn/codex-proxy-plugins/tree/c1e1d5398990097f3987d595e5b3ea737ec2b66e/examples/workbench)，提交 `c1e1d5398990097f3987d595e5b3ea737ec2b66e` 的 README、api/host.ts、api/request.ts、validation.ts、api/schemas 与 api/modules。

## 已有复用和保留项

- 原版已真实依赖 `@codex-proxy/ui`，不是只模仿外观；ZTable、ZPagination、ZSwitch、ZButton、ZIconButton、ZInput、ZInputNumber、ZSelect、ZPopover、ZCheckbox、ZDialog 均为公开组件。
- 保留 Vue SFC + TypeScript、官方 UI Vite 插件和 Tailwind 4 入口；打包静态资源，不加载 CDN 运行时代码。
- 后端通过公开 `PluginSession` / `PluginBuilder` 注册 management v2、maintenance v1，清单为 v2、进程协议为 RPC v7；私有状态和原生账号维护通过宿主能力完成，不访问宿主数据库、内部 Rust 模块或账号凭据。
- 安装页主题由宿主注入；仅本地预览调用 UI 公开主题 API。
- 会员标识、额度条和摘要是业务呈现；上游没有对应的额度/重置卡组件，不强行复制或导入宿主内部业务组件。

## 修正项

| 原状态 | 修正 | 位置 |
| --- | --- | --- |
| UI 使用 Git 标签源码依赖 | 切到官方预编译 v0.4.1 tgz，核对官方 SHA-256，锁定 integrity | frontend/package.json、pnpm-lock.yaml |
| 卡片选择为原生自写 radio | 使用公开 ZRadio，保留键盘导航、焦点和禁用状态 | frontend/src/App.vue |
| 插件自定深浅主题兜底色 | 删除自有 HEX 兜底与深色规则，字体/颜色取宿主 token，根背景透明 | frontend/src/style.css |
| API 混在一个泛型强制转换文件 | 按示例分离 host、request、modules、schemas，返回 unknown 后逐字段解码 | frontend/src/api/ |
| 响应仅 JSON.parse 后断言类型 | 校验布尔、数组、非负整数、可空字段、未决操作和记录，处理无效 JSON、非 JSON、错误形状 | frontend/src/api/ |
| Blob 下载导航受隔离策略阻止 | 使用 ZDialog + ZTextarea 展示 CSV，复制/全选，不增加 sandbox 权限 | frontend/src/ExportDialog.vue、format.ts |
| 示例适配来源缺少说明 | 加入来源提交、改动说明和 Apache-2.0 许可，随包提供 | LICENSES/ |

## 宿主兼容合同

- 宿主支持清单仅接受 RPC v7 与 management v2；`plugin.json` 显式声明 management v2，安装包由同提交官方 CLI 生成协议版本与文件摘要。
- SDK 锁定上述提交，最低 Rust 工具链为 1.99.1。宿主范围限定为 `>=3.36.0, <3.37.0`，不把旧版 RPC v2 宿主包含在同一范围内。
- 账号运行投影、额度观测、`host.state.get/put`、重置卡查询/消费路由及 canonical UUIDv4 幂等字段继续使用公开合同；不调用新版宿主自动重置配置接口。
- 私有状态命名空间、schemaVersion、插件 ID 与键名保持一致，版本切换沿用原实例；协议测试覆盖设置、逐号开关与未决请求的重启恢复。

## 不变的业务边界

Free 排除、完整邮箱显示、会员筛选、分页/页容量、内联检测设置、全局关闭同步逐号关闭、手动消费确认、持久幂等请求、原账号启用及分组配置均保留。
不把示例的模型调用、密钥处理或其他无关权限引入本插件，不修改宿主服务或 Nginx。

## 验证

新增前端测试：`node verification/frontend-test.mjs`。公开验证说明见 [docs/VERIFICATION.md](../docs/VERIFICATION.md)。
本地预览不能代替真实 sandbox 安装验收；真实自动启用和消费不用于线上测试。
