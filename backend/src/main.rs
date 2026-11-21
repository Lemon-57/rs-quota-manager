//! 插件协议会话与串行管理、维护入口

mod engine;
mod host;
mod management;
mod model;
mod native;

use gateway_plugin_sdk::{
    Manifest,
    client::{
        Empty, PluginBuilder, PluginSession, SessionConfig, SessionError, TypedReply, methods,
    },
};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let session = PluginSession::accept(
        tokio::io::stdin(),
        tokio::io::stdout(),
        SessionConfig::default(),
    )
    .await?;
    let manifest = Manifest::from_author_slice(include_bytes!("../../plugin.json"))?;
    if session.handshake().plugin_id != manifest.plugin_id()?
        || session.handshake().contributes != manifest.contributes
    {
        return Err(SessionError::Handshake.into());
    }
    let lock = Arc::new(Mutex::new(()));
    let maintenance_lock = Arc::clone(&lock);
    let plugin = PluginBuilder::from_json(include_bytes!("../../plugin.json"))?
        .management(management::registration(), move |call| {
            let lock = Arc::clone(&lock);
            async move {
                let _guard = lock.lock().await;
                management::handle(call).await
            }
        })?
        .on(methods::RECONCILE, move |call| {
            let lock = Arc::clone(&maintenance_lock);
            async move {
                let Ok(_guard) = lock.try_lock() else {
                    return Ok(TypedReply::new(Empty {}));
                };
                engine::reconcile(&call.host, call.context.timeout_ms).await?;
                Ok(TypedReply::new(Empty {}))
            }
        })?
        .build()?;
    session.run(plugin).await?;
    Ok(())
}
