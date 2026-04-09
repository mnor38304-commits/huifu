-- ============================================================
-- UQPay Issuing API 瀵规帴 鈥?鏁版嵁搴撹縼绉昏剼鏈?
-- ============================================================
-- 鐢ㄩ€? : 涓?card_channels 琛ㄥ鍔?UQPAY 娓犻亾
--        涓?cards 琛ㄥ鍔?uqpay_cardholder_id 瀛楁
--        鍐欏叆 UQPAY 鍒濆娓犻亾璁板綍
-- 鎵ц  : 鍦?Railway MySQL 鎺у埗鍙扮洿鎺ユ墽琛岋紝鎴栭€氳繃 Flyway/Knex 杩佺Щ妗嗘灦
-- ============================================================

-- 鈹€鈹€ 0. card_channels 琛ㄥ鍔?priority / api_key / api_secret 瀛楁 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
--    鐜版湁琛ㄥ彲鑳芥病鏈夎繖浜涘瓧娈碉紝鍏堟坊鍔狅紙MySQL IGNORE 鍙湪 INSERT 鏃跺拷鐣ユ姤閿欙級

ALTER TABLE card_channels
  ADD COLUMN IF NOT EXISTS priority       INT DEFAULT 99 COMMENT '娓犻亾浼樺厛绾э紝鏁板瓧瓒婂皬瓒婁紭鍏?,
  ADD COLUMN IF NOT EXISTS api_key         VARCHAR(256) NULL COMMENT 'API Key / Client ID',
  ADD COLUMN IF NOT EXISTS api_secret      VARCHAR(256) NULL COMMENT 'API Secret';


-- 鈹€鈹€ 1. card_channels 琛ㄥ鍔?UQPAY 娓犻亾璁板綍 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

INSERT INTO card_channels
  (channel_code, channel_name, api_base_url, status, config_json,
   api_key, api_secret, priority, created_at, updated_at)
VALUES
  ('UQPAY', 'UQPay 鍙戝崱',
   -- Sandbox 鐜
   'https://api-sandbox.uqpaytech.com',
   0,                         -- 榛樿绂佺敤锛屽緟閰嶇疆 credentials 鍚庢墜鍔ㄥ惎鐢?
   -- config_json: 瀛樻斁 clientId / apiSecret / depositAddresses
   '{"clientId":"YOUR_CLIENT_ID","apiSecret":"YOUR_API_KEY","depositAddresses":{"trx":"TRX_DEPOSIT_ADDRESS","eth":"ETH_DEPOSIT_ADDRESS"}}',
   -- api_key / api_secret: 鍏煎鏃т唬鐮佺殑瀛楁锛堝彲鍚屾椂鍐欏叆锛?
   'YOUR_CLIENT_ID',
   'YOUR_API_KEY',
   1,                         -- 鏈€楂樹紭鍏堢骇
   NOW(),
   NOW())
ON DUPLICATE KEY UPDATE
  channel_name = VALUES(channel_name),
  api_base_url = VALUES(api_base_url),
  config_json = VALUES(config_json),
  api_key      = VALUES(api_key),
  api_secret   = VALUES(api_secret),
  priority     = VALUES(priority),
  updated_at   = NOW();


-- 鈹€鈹€ 2. cards 琛ㄥ鍔?uqpay_cardholder_id 瀛楁 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
--    鐢ㄤ簬缂撳瓨 UQPay 鎸佸崱浜?ID锛岄伩鍏嶉噸澶嶅垱寤烘寔鍗′汉

ALTER TABLE cards
  ADD COLUMN uqpay_cardholder_id VARCHAR(64) NULL
  COMMENT 'UQPay 鎸佸崱浜?ID锛屽叧鑱?issuing/cardholders'
  AFTER channel_code;

CREATE INDEX idx_cards_uqpay_cardholder
  ON cards (uqpay_cardholder_id);


-- 鈹€鈹€ 3. card_transactions 琛紙鏂板锛屽缓璁級鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
--    鐙珛浜ゆ槗琛ㄧ敤浜庤褰?UQPay 娓犻亾鐨勪氦鏄撴祦姘?

CREATE TABLE IF NOT EXISTS card_transactions (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  txn_no         VARCHAR(64)  NOT NULL UNIQUE COMMENT '浜ゆ槗娴佹按鍙?,
  card_id        BIGINT      NOT NULL COMMENT '鍏宠仈 cards.id',
  external_txn_id VARCHAR(64) NULL COMMENT 'UQPay 娓犻亾浜ゆ槗 ID',
  channel_code   VARCHAR(20)  NOT NULL DEFAULT 'UQPAY' COMMENT '娓犻亾缂栫爜',
  txn_type       ENUM('TOPUP','REFUND','AUTH','CAPTURE','FEE','CANCEL_REFUND') NOT NULL,
  amount         DECIMAL(12,2) NOT NULL COMMENT '浜ゆ槗閲戦',
  currency       VARCHAR(3)   NOT NULL DEFAULT 'USD',
  fee            DECIMAL(12,2) DEFAULT 0 COMMENT '鎵嬬画璐?,
  status         TINYINT      NOT NULL DEFAULT 0 COMMENT '0-澶勭悊涓?1-鎴愬姛 2-澶辫触',
  merchant_name  VARCHAR(128) NULL,
  description    VARCHAR(512) NULL,
  metadata       JSON         NULL COMMENT '娓犻亾鍘熷鍝嶅簲',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_card_txn (card_id, created_at),
  INDEX idx_external_txn (external_txn_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='鍙戝崱娓犻亾浜ゆ槗娴佹按';


-- 鈹€鈹€ 4. UQPAY 鐜鍒囨崲璇存槑 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
--
--  鈿狅笍  姝ｅ紡鐢熶骇鐜閮ㄧ讲鍓嶏紝鍔″繀淇敼 api_base_url锛?
--
--  Sandbox锛堟祴璇曪級:
--    api_base_url = https://api-sandbox.uqpaytech.com
--
--  鐢熶骇鐜:
--    api_base_url = https://api.uqpaytech.com
--
--  淇敼鏂瑰紡:
--    UPDATE card_channels SET api_base_url = 'https://api.uqpaytech.com'
--    WHERE channel_code = 'UQPAY';
--
--  鍚屾椂鏇存柊 config_json 涓殑 credentials:
--    UPDATE card_channels SET
--      config_json = JSON_SET(
--        config_json,
--        '$.clientId', 'PROD_CLIENT_ID',
--        '$.apiSecret', 'PROD_API_KEY'
--      )
--    WHERE channel_code = 'UQPAY';


-- 鈹€鈹€ 5. 鍚敤 UQPAY 娓犻亾锛堥厤缃畬鎴愬悗鎵ц锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

-- UPDATE card_channels SET status = 1 WHERE channel_code = 'UQPAY';

-- 鈹€鈹€ 6. 楠岃瘉鎻掑叆缁撴灉 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

SELECT channel_code, channel_name, api_base_url,
       SUBSTR(config_json, 1, 80) AS config_preview,
       status, priority
FROM card_channels
WHERE channel_code IN ('AIRWALLEX', 'PHOTON', 'UQPAY')
ORDER BY priority ASC;
