import React from 'react';
import { FiEye, FiEyeOff, FiCheckCircle, FiDownload } from 'react-icons/fi';

/**
 * Open-tracking indicator for an email we sent.
 *
 * Deliberately worded as "Opened" rather than "Read". A tracking pixel fires
 * when a mail client loads images, which is not the same as a person reading
 * the message: Apple Mail Privacy Protection pre-fetches images on delivery,
 * and clients with images disabled never fire at all. The tooltip says so, so
 * nobody treats this as certainty when chasing a client.
 *
 * Photo emails are different: they link to a private gallery, and a view or
 * download there needs a real click. When a `delivery` is passed and shows
 * one, that confirmed receipt replaces the pixel-based one.
 */

const formatWhen = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: true
  })}`;
};

const ReadReceiptBadge = ({ message, delivery = null, className = '' }) => {
  // Only sent emails carry a pixel; inbound mail and SMS have nothing to show.
  const isSentEmail = (message?.type === 'email' || message?.type === 'both')
    && (message?.status === 'sent' || message?.email_status === 'sent');

  if (!isSentEmail) return null;

  if (delivery?.first_downloaded_at) {
    const n = delivery.download_count || 1;
    return (
      <span
        title={`Downloaded their photos ${formatWhen(delivery.first_downloaded_at)}` +
          (n > 1 ? ` · ${n} downloads, last ${formatWhen(delivery.last_downloaded_at)}` : '') +
          '. Confirmed - this needs a real click.'}
        className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full
                    font-semibold bg-emerald-600 text-white ${className}`}
      >
        <FiDownload className="h-2.5 w-2.5" />
        Downloaded
      </span>
    );
  }

  if (delivery?.first_viewed_at) {
    const n = delivery.view_count || 1;
    return (
      <span
        title={`Opened their photo gallery ${formatWhen(delivery.first_viewed_at)}` +
          (n > 1 ? ` · ${n} visits, last ${formatWhen(delivery.last_viewed_at)}` : '') +
          '. Confirmed - this needs a real click.'}
        className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full
                    font-semibold bg-indigo-600 text-white ${className}`}
      >
        <FiCheckCircle className="h-2.5 w-2.5" />
        Viewed gallery{n > 1 ? ` ${n}x` : ''}
      </span>
    );
  }

  const openCount = message.open_count || 0;

  if (!message.opened_at) {
    return (
      <span
        title="No open recorded yet. Some clients block tracking images entirely, so this is not proof it was missed."
        className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full
                    font-medium bg-gray-100 text-gray-500 ${className}`}
      >
        <FiEyeOff className="h-2.5 w-2.5" />
        Not opened
      </span>
    );
  }

  const tooltip =
    `First opened ${formatWhen(message.opened_at)}` +
    (openCount > 1 ? ` · ${openCount} opens, last ${formatWhen(message.last_opened_at)}` : '') +
    '. Tracked by an image pixel - Apple Mail can pre-load images, so treat this as a strong hint rather than proof.';

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full
                  font-medium bg-green-100 text-green-700 ${className}`}
    >
      <FiEye className="h-2.5 w-2.5" />
      Opened{openCount > 1 ? ` ${openCount}x` : ''}
    </span>
  );
};

export default ReadReceiptBadge;
