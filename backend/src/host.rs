//! 原生宿主查询、受管管理请求与私有状态的版本校验

use gateway_plugin_sdk::{
    ErrorCode, PluginFault,
    call::{
        host::{
            STATE_GET, STATE_PUT, StateGetRequest, StateGetResult, StatePutRequest, StatePutResult,
        },
        middleware::{MiddlewareHeader, http::Version},
    },
    client::{HostClient, HttpBody, HttpFrame, HttpRequest},
};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

const STATE_NAMESPACE: &str = "quota-manager";

pub fn fault(message: &str) -> PluginFault {
    PluginFault::new(ErrorCode::Rejected, message)
}
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub async fn load<T: DeserializeOwned + Default>(
    host: &HostClient,
    key: &str,
) -> Result<(T, Option<u64>), PluginFault> {
    let request = StateGetRequest {
        namespace: STATE_NAMESPACE.into(),
        key: key.into(),
    };
    let reply = host
        .call(
            STATE_GET,
            serde_json::to_value(request).map_err(|_| fault("插件状态查询参数无效"))?,
            vec![],
        )
        .await
        .map_err(|e| e.into_plugin_fault())?;
    let result: StateGetResult =
        serde_json::from_value(reply.result).map_err(|_| fault("插件状态无法读取"))?;
    match result.record {
        Some(record) => Ok((
            serde_json::from_value(record.value).map_err(|_| fault("插件状态格式不匹配"))?,
            Some(record.version),
        )),
        None => Ok((T::default(), None)),
    }
}

pub async fn save<T: Serialize>(
    host: &HostClient,
    key: &str,
    value: &T,
    version: Option<u64>,
) -> Result<u64, PluginFault> {
    let request = StatePutRequest {
        namespace: STATE_NAMESPACE.into(),
        key: key.into(),
        value: serde_json::to_value(value).map_err(|_| fault("插件状态编码失败"))?,
        expected_version: version,
    };
    let reply = host
        .call(
            STATE_PUT,
            serde_json::to_value(request).map_err(|_| fault("插件状态保存参数无效"))?,
            vec![],
        )
        .await
        .map_err(|e| e.into_plugin_fault())?;
    let result: StatePutResult =
        serde_json::from_value(reply.result).map_err(|_| fault("插件状态保存结果无效"))?;
    Ok(result.version)
}

pub async fn admin(
    host: &HostClient,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, PluginFault> {
    let (headers, body) = match body {
        Some(value) => (
            vec![MiddlewareHeader {
                name: "content-type".into(),
                value: b"application/json".to_vec(),
            }],
            HttpBody::from_bytes(serde_json::to_vec(&value).map_err(|_| fault("请求编码失败"))?),
        ),
        None => (vec![], HttpBody::empty()),
    };
    let mut reply = host
        .dispatch_http(HttpRequest {
            settings: Value::Null,
            method: method.into(),
            uri: path.into(),
            version: Version::Http11,
            headers,
            timeout_ms: Some(12000),
            body,
        })
        .await?;
    let mut bytes = Vec::new();
    while let Some(frame) = reply.body.read().await? {
        if let HttpFrame::Data(chunk) = frame {
            if bytes.len() + chunk.len() > 2097152 {
                reply.body.close().await?;
                return Err(fault("宿主响应过大"));
            }
            bytes.extend(chunk);
        }
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| fault("宿主响应无效"))?;
    if !(200..300).contains(&reply.status) || value.get("code").and_then(Value::as_u64) != Some(200)
    {
        let mut error = fault("宿主操作失败，请检查账号状态后重试");
        error.http_status = Some(reply.status);
        return Err(error);
    }
    value
        .get("data")
        .cloned()
        .ok_or_else(|| fault("宿主响应缺少数据"))
}

pub fn account_path(path: &str, account_id: &str) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("accountId", account_id)
        .finish();
    format!("/api/admin/accounts/{path}?{query}")
}
