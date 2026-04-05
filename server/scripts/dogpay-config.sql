
-- DogPay 渠道配置
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
  'https://api.dogpay.com',
  '2029791977437134849',
  'WgCo4HShHRLVBYmeJH5wT9IkkYZilxR4',
  '',
  1,
  '{}'
)
ON CONFLICT(channel_code) DO UPDATE SET
  channel_name = excluded.channel_name,
  api_base_url = excluded.api_base_url,
  api_key = excluded.api_key,
  api_secret = excluded.api_secret,
  webhook_secret = excluded.webhook_secret,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;
