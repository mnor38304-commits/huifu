-- DogPay 渠道配置脚本
-- 请替换以下占位符为实际的 DogPay 平台提供的值

-- 插入/更新 DogPay 渠道配置
INSERT INTO card_channels (
  channel_code,
  channel_name,
  api_base_url,
  api_key,
  api_secret,
  webhook_secret,
  status,
  config_json
) VALUES (
  'dogpay',
  'DogPay 虚拟卡',
  'https://api.dogpay.com',  -- DogPay API 基础地址
  'YOUR_API_KEY_HERE',       -- 替换为你的 API Key
  'YOUR_API_SECRET_HERE',    -- 替换为你的 API Secret
  'YOUR_WEBHOOK_SECRET',     -- 替换为你的 Webhook Secret（可选）
  1,                         -- 状态: 1=启用, 0=禁用
  '{"rsa_public_key":"","rsa_private_key":""}'  -- 额外配置 JSON
)
ON CONFLICT(channel_code) DO UPDATE SET
  channel_name = excluded.channel_name,
  api_base_url = excluded.api_base_url,
  api_key = excluded.api_key,
  api_secret = excluded.api_secret,
  webhook_secret = excluded.webhook_secret,
  status = excluded.status,
  config_json = excluded.config_json,
  updated_at = CURRENT_TIMESTAMP;

-- 查看配置
SELECT 
  id,
  channel_code,
  channel_name,
  api_base_url,
  CASE 
    WHEN api_key IS NOT NULL AND length(api_key) > 0 
    THEN substr(api_key, 1, 6) || '...' || substr(api_key, -4)
    ELSE '未设置'
  END as api_key_masked,
  CASE 
    WHEN api_secret IS NOT NULL AND length(api_secret) > 0 
    THEN '已设置'
    ELSE '未设置'
  END as api_secret_status,
  status,
  created_at,
  updated_at
FROM card_channels 
WHERE channel_code = 'dogpay';
