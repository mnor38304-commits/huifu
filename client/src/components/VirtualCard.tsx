import React from 'react';

interface VirtualCardProps {
  cardNumberMasked: string;
  expiryMasked: string;
  cvvMasked: string;
  cardHolderName?: string;
  isFlipped?: boolean;
  style?: React.CSSProperties;
}

const VirtualCard: React.FC<VirtualCardProps> = ({
  cardNumberMasked = '**** **** **** ****',
  expiryMasked = '**/**',
  cvvMasked = '***',
  cardHolderName = 'CARDHOLDER',
  isFlipped = false,
  style,
}) => {
  const formatCardNumber = (num: string) => {
    const digits = num.replace(/\D/g, '');
    if (digits.length <= 4) return num;
    const groups = digits.match(/.{1,4}/g);
    return groups ? groups.join(' ') : num;
  };

  return (
    <div style={{ perspective: 1000, width: 340, height: 214, ...style }}>
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        transition: 'transform 0.6s ease',
        transformStyle: 'preserve-3d',
        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}>
        {/* Front */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 14,
          overflow: 'hidden',
          backfaceVisibility: 'hidden',
          background: 'linear-gradient(135deg, #f8f9fa 0%, #ffffff 40%, #f0f0f0 100%)',
          border: '1px solid #e0e0e0',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          {/* Top: Brand + Chip */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{
                fontFamily: "'Inter', 'Segoe UI', sans-serif",
                fontWeight: 800,
                fontSize: 20,
                letterSpacing: 3,
                color: '#1a1a2e',
              }}>
                CARDGOLINK
              </div>
              <div style={{
                fontSize: 8,
                color: '#999',
                letterSpacing: 1,
                marginTop: 1,
              }}>
                VIRTUAL CREDIT CARD
              </div>
            </div>
            {/* Chip icon */}
            <svg width="38" height="28" viewBox="0 0 38 28">
              <rect x="1" y="1" width="36" height="26" rx="4" fill="#e8d5a3" stroke="#c4a35a" strokeWidth="1" />
              <rect x="10" y="1" width="18" height="26" rx="0" fill="none" stroke="#c4a35a" strokeWidth="0.8" />
              <rect x="1" y="7" width="10" height="14" rx="0" fill="none" stroke="#c4a35a" strokeWidth="0.6" />
              <rect x="27" y="7" width="10" height="14" rx="0" fill="none" stroke="#c4a35a" strokeWidth="0.6" />
              <rect x="14" y="4" width="10" height="20" rx="0" fill="none" stroke="#c4a35a" strokeWidth="0.6" opacity="0.4" />
            </svg>
          </div>

          {/* Card number */}
          <div style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: 2,
            color: '#1a1a2e',
            textAlign: 'center',
            marginTop: 16,
          }}>
            {formatCardNumber(cardNumberMasked)}
          </div>

          {/* Bottom: Expiry + CVV + decorative circles */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontSize: 7, color: '#999', letterSpacing: 1, marginBottom: 2 }}>VALID THRU</div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 600, color: '#333' }}>
                  {expiryMasked}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 7, color: '#999', letterSpacing: 1, marginBottom: 2 }}>CVV</div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 600, color: '#333' }}>
                  {cvvMasked}
                </div>
              </div>
            </div>
            {/* Decorative card network circles */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, #d4a853, #f5d78e)',
                opacity: 0.8,
              }} />
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, #c0c0c0, #e8e8e8)',
                opacity: 0.6,
                marginLeft: -10,
              }} />
            </div>
          </div>

          {/* Gold accent line */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, #d4a853, #f5d78e, #d4a853)',
          }} />
        </div>

        {/* Back */}
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 14,
          overflow: 'hidden',
          backfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          background: '#f0f0f0',
          border: '1px solid #e0e0e0',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        }}>
          {/* Magnetic stripe */}
          <div style={{
            marginTop: 24,
            height: 40,
            background: '#333',
          }} />
          {/* Signature strip */}
          <div style={{
            margin: '16px 20px',
            padding: '0 12px',
            height: 36,
            background: 'linear-gradient(90deg, #fff 80%, #e8e8e8 100%)',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            border: '1px solid #ddd',
          }}>
            <div style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 14,
              fontStyle: 'italic',
              color: '#999',
            }}>
              {cvvMasked}
            </div>
          </div>
          <div style={{
            padding: '0 20px',
            fontSize: 8,
            color: '#999',
            lineHeight: 1.5,
          }}>
            This card is issued by CardGoLink pursuant to a license from a payment network. Use of this card constitutes acceptance of the terms and conditions.
          </div>
        </div>
      </div>
    </div>
  );
};

export default VirtualCard;
