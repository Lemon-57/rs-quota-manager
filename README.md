# 周限与重置卡

独立 RS 网关插件，插件 ID 为 `personal.quota-manager`，当前源码版本 `0.1.6`，公开版本以 Releases 为准

基于上游 `v3.36.0` 的公开 SDK，固定提交 `5ae38dc0c55c192815ef605dde6c05fd767a2c28`，清单为 v2、进程协议为 RPC v7，声明 management v2 与 maintenance v1

## 安装与兼容

- 下载：[安装包与校验文件](https://github.com/Lemon-57/rs-quota-manager/releases)
- 宿主兼容范围：`>=3.36.0, <3.37.0`，已核对 v3.36.0 的插件、账号、额度与卡片接口契约；验证范围见 [验证说明](docs/VERIFICATION.md)。
- 当前制品：Linux x86_64，glibc 2.28 及以上。尚未发布 ARM64、Windows 或 macOS 安装包。
- 插件 ID：`personal.quota-manager`。为保留既有安装配置和私有状态，继续沿用该身份。
- 许可证：Apache-2.0，第三方来源见 [LICENSES/NOTICE.md](LICENSES/NOTICE.md)。

CPR 3.36 使用 v0.1.6 或后续明确兼容的安装包。源码构建后，通过“插件管理 → 安装插件 → 上传”选择 `dist/` 内的 `.tar.gz`，先核对同目录 `.sha256`。
通过 GitHub 安装已发布版本时，仓库填写 `Lemon-57/rs-quota-manager`，选择兼容发行版及匹配架构的附件；公开 Releases 是否包含 v0.1.6 以实际页面为准。不要上传 GitHub 自动生成的 Source code 归档。

v0.1.6 使用新版进程协议，不适用于旧宿主；CPR `>=3.26.2, <3.28.0` 继续使用 v0.1.5。已有安装应切换原实例的版本，保留插件 ID、设置、卡片缓存、未决请求和历史，不要删除实例后重建。
首次安装时确认来源并接受完整信任，启用配置后从侧栏打开“周限与重置卡”。

以下截图全部为本地模拟数据，不含真实账号、卡片或消费结果。

![账号周限与重置卡列表，模拟数据](docs/screenshots/overview.png)

![手动选择重置卡，模拟数据](docs/screenshots/cards.png)

## 安全边界

自动使用默认关闭。开启自动使用或确认手动消费会通过宿主调用上游接口，可能真实消耗重置卡，消费无法撤回。
只对支持重置的 OpenAI OAuth 非 Free 账号执行卡片操作；已停用账号不参与自动消费，不修改账号启用状态或分组。
结果不确定时保留原请求标识并阻止再次消费其他卡片；总开关关闭不能撤回已经发出的请求。
公开验证覆盖规则、协议、页面及安装流程，未执行真实卡片消费；不同上游套餐与卡片格式仍可能存在兼容性差异。
CSV 包含账号 ID、完整名称和邮箱，若原名称含敏感内容，请勿将导出内容公开。

## 使用

在网关的插件管理中上传安装 `dist/personal.quota-manager-0.1.6-x86_64-unknown-linux-gnu.tar.gz`，核对旁边的 SHA-256 文件，接受来源并确认配置处于启用状态，再打开“周限与重置卡”页面

- 读取 RS 当前账号套餐和启用状态，排除套餐为 Free 的账号，账号列只显示完整邮箱，无邮箱时回退到名称；列表同时显示会员标识、周限、刷新时间、卡张数及到期时间，内部 ID 与账号名称仍参与搜索和导出
- 按宿主真实 `planType` 判断套餐，名称带 `team+` 的 Free 同样排除，列表、汇总、后台查询和新消费共用该规则
- 账号页默认读取已有额度观测和插件卡片缓存，卡片未查询会显示“未查询”，不会显示成零张
- “更新筛选账号”按当前筛选逐个查询额度和卡片，两号之间间隔一秒，可以停止后续查询，关闭页面后不继续批量更新
- 手动使用通过每行的卡片图标打开，选择一张卡并确认消费
- 自动使用默认关闭，总开关直接同步全部适用账号，不显示启用确认弹窗，开启后仍可逐号关闭；全局关闭时所有账号均停止自动使用并显示关闭，账号原有启用状态保持不变
- 总开关关闭时单独开启某个账号，只开启该账号，其他账号保持关闭，逐号设置保存后刷新或重启仍生效
- 日期按浏览器本地时区显示，支持搜索、筛选、排序和 CSV 导出；隔离页面不支持下载导航，导出改为官方弹窗中的只读 CSV 和复制、全选操作，不扩展宿主权限。分页复用 RS 使用统计的 ZPagination，默认每页 10 条，可选 10、20、50、100 条及页码跳转
- 页面复用公开 ZCard 指标卡、ZTag 会员标签、输入框、开关、表格、分页和选卡控件，随宿主主题同步，可按会员标识和状态筛选
- 检测间隔、批次大小和卡片更新间隔直接显示在工具栏，点击保存图标提交，未保存的修改可撤销，后台快照更新不会覆盖草稿
- 后台刷新不禁用筛选与分页，不覆盖用户刚修改的开关，批量更新失败时保留账号列表

## 自动规则

每批默认检查 20 个账号，批次间隔 30 秒，沿账号 ID 轮转，每批至多一个账号访问上游，后台与管理操作共用串行入口

自动触发只识别 `codex` 通用桶的唯一 604800 秒窗口，窗口未过期、最新额度观测不超过两分钟且已用比例达到 100% 才能消费
消费前通过宿主刷新额度和卡片列表，优先使用最早到期、仍可用且明确包含周限的卡，5 小时额度或模型专属周限不触发自动操作

完整巡检时间取决于宿主账号总数及上游延迟，巡检分页会跳过 Free，维护调用由宿主每 30 秒唤醒
卡片缓存默认每小时更新，首次查询采用轮转渐进填充；需要完整的新鲜库存时使用“更新筛选账号”

UUID 在消费前通过宿主私有状态持久化，结果不确定时暂停该号自动消费，并保留原卡与原 UUID
“确认原操作”只复用原请求标识，不选择另一张卡，进程重启仍保留未决操作，账号降为 Free 时移出业务列表，其原有未决操作单独保留确认入口
确认成功后回读额度与卡片；额度尚未恢复时保持等待状态，直到收到消费后的低于 100% 的新周限观测

每号保留最近 20 条已确认业务结果，宿主原生消费接口同时保留其自身的审计语义
关闭自动开关阻止后续自动消费，已经发出的消费请求不会被撤回

## 构建

全部构建与验证在本机运行，生产服务器只接收完成的安装包
Rust 使用 1.99.1，前端推荐 Node 24 和 pnpm，SDK 与前端依赖由锁文件固定；本机验证版本见 [验证说明](docs/VERIFICATION.md)

```powershell
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend build
cargo +1.99.1 fmt --manifest-path backend/Cargo.toml -- --check
cargo +1.99.1 clippy --manifest-path backend/Cargo.toml --all-targets --locked -- -D warnings
cargo +1.99.1 test --manifest-path backend/Cargo.toml --locked
cargo +1.99.1 build --manifest-path backend/Cargo.toml --locked
node verification/protocol-test.mjs
node verification/frontend-test.mjs
```

Windows 本机生成 Linux 制品需要安装 Zig、cargo-zigbuild 和 Rust Linux target，把 Zig 与 cargo-zigbuild 加入 PATH

```powershell
rustup target add x86_64-unknown-linux-gnu --toolchain 1.99.1
cargo +1.99.1 zigbuild --manifest-path backend/Cargo.toml --release --locked --target x86_64-unknown-linux-gnu.2.28
cpr-plugin package --manifest plugin.json --binary backend/target/x86_64-unknown-linux-gnu/release/quota-manager --target x86_64-unknown-linux-gnu --resource-map web=frontend/dist --resource-map legal=LICENSES --output-dir dist
```

`cpr-plugin` 应从上面的 v3.36.0 宿主固定提交构建，不能复用只支持旧进程协议的 CLI，安装包支持 Linux x86_64、glibc 2.28 及以上
Linux 发布同样使用 `cargo zigbuild --release --locked --target x86_64-unknown-linux-gnu.2.28` 保留 glibc 2.28 基线，再用同一 CLI 打包；普通原生构建只保证本机构建环境的 glibc 兼容性

## 上游复用

按 Issue #278、官方 UI 安装文档和 plugins/workbench 示例核对，详见 `verification/UPSTREAM-COMPLIANCE.md`。
UI 通过官方 v0.4.1 编译发行包安装，SHA-256 与官方校验文件一致，并写入 pnpm 锁文件 integrity；业务代码只导入公开组件、样式、主题与 Vite 入口。
插件示例仓库不是运行时依赖，复用其公开宿主桥、请求层与运行时解码组织方式，不导入其内部业务代码，也不降级当前宿主 SDK。
来源与许可见 `LICENSES/NOTICE.md`，随插件包一并提供。

## 验证边界

`verification/protocol-test.mjs` 启动真实插件进程，以模拟宿主验证握手、分页、设置冲突、自动触发、卡片选择、暂停状态、不确定结果、重启恢复及幂等键复用
测试不访问真实网关或真实上游，不消费真实卡片

`pnpm --dir frontend dev --port 5176` 提供带明确标识的本地模拟预览，发行页面只使用 `window.codexProxyPlugin` 宿主桥，不请求管理员密码或读取管理 Cookie
安装包声明兼容 `>=3.36.0, <3.37.0`，本地模拟宿主验证 RPC v7、management v2、状态读写和业务协议；未在真实 v3.36.0 宿主完成安装与页面验收，未执行真实卡片消费。具体证据和限制见 [验证说明](docs/VERIFICATION.md)

## 页面加载排查

宿主会校验页面资源的 sandbox CSP 和 `X-Content-Type-Options: nosniff`
Nginx 同时透传上游同名头并追加 `nosniff` 会产生 `nosniff, nosniff`，从而触发“服务返回了不受支持的响应”
在已有 Nginx `add_header X-Content-Type-Options nosniff always;` 的站点中，使用 `proxy_hide_header X-Content-Type-Options;` 保留单个安全头
修改需要备份并通过配置检查，平滑重载须保留在途连接；浏览器缓存旧响应头时需强制刷新页面
