class GmailEmailExtractor {
  constructor(gmail) {
    this.gmail = gmail;
  }

  decodeBase64Url(data) {
    if (!data) return '';
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;
    return Buffer.from(paddedBase64, 'base64').toString('utf8');
  }

  async extractEmailContent(message, messageId) {
    const payload = message.payload || message;
    let htmlContent = '';
    let textContent = '';
    const embeddedImages = [];

    if (payload.parts) {
      const result = await this.extractFromParts(payload.parts, messageId);
      htmlContent = result.html;
      textContent = result.text;
      embeddedImages.push(...result.embeddedImages);
    } else if (payload.body?.data) {
      const decoded = this.decodeBase64Url(payload.body.data);
      if (payload.mimeType === 'text/html') {
        htmlContent = decoded;
        textContent = this.htmlToText(decoded);
      } else if (payload.mimeType === 'text/plain') {
        textContent = decoded;
      }
    }

    return {
      html: htmlContent,
      text: textContent || this.htmlToText(htmlContent),
      embeddedImages
    };
  }

  async extractFromParts(parts, messageId) {
    let htmlContent = '';
    let textContent = '';
    const embeddedImages = [];

    if (!parts || !Array.isArray(parts)) {
      return { html: htmlContent, text: textContent, embeddedImages };
    }

    for (const part of parts) {
      if (part.parts) {
        const nested = await this.extractFromParts(part.parts, messageId);
        if (!htmlContent) htmlContent = nested.html;
        if (!textContent) textContent = nested.text;
        embeddedImages.push(...nested.embeddedImages);
      }

      const mimeType = part.mimeType || '';
      const bodyData = part.body?.data;
      const attachmentId = part.body?.attachmentId;

      if (mimeType === 'text/html' && bodyData && !attachmentId) {
        htmlContent = this.decodeBase64Url(bodyData);
      }

      if (mimeType === 'text/plain' && bodyData && !attachmentId) {
        textContent = this.decodeBase64Url(bodyData);
      }

      // For embedded CID images, download and convert to base64 data URLs
      if (mimeType.startsWith('image/') && attachmentId) {
        const headers = part.headers || [];
        const contentId = headers.find(h => h.name.toLowerCase() === 'content-id')?.value || '';
        const contentDisposition = headers.find(h => h.name.toLowerCase() === 'content-disposition')?.value || '';

        if (contentDisposition.toLowerCase().includes('inline') || contentId) {
          try {
            const img = await this.extractEmbeddedImageAsDataUrl(messageId, attachmentId, contentId, mimeType);
            if (img) embeddedImages.push(img);
          } catch (error) {
            console.error(`⚠️ Error extracting embedded image: ${error.message}`);
          }
        }
      }
    }

    return { html: htmlContent, text: textContent, embeddedImages };
  }

  async extractEmbeddedImageAsDataUrl(messageId, attachmentId, contentId, mimeType) {
    try {
      const attachmentResponse = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: messageId,
        id: attachmentId
      });

      const fileData = attachmentResponse.data.data;
      const base64 = fileData.replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4;
      const paddedBase64 = pad ? base64 + '='.repeat(4 - pad) : base64;
      const dataUrl = `data:${mimeType};base64,${paddedBase64}`;

      return {
        contentId: contentId.replace(/[<>]/g, ''),
        dataUrl,
        mimetype: mimeType
      };
    } catch (error) {
      console.error(`❌ Error extracting embedded image:`, error.message);
      return null;
    }
  }

  htmlToText(html) {
    if (!html) return '';
    let text = html;
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<\/?(div|p|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
    text = text.replace(/<\/td>/gi, '\t');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/^\s+|\s+$/gm, '');
    return text.trim();
  }

  cleanEmailBody(body, isHtml = false) {
    if (!body) return '';
    if (isHtml) return body;

    const lines = body.split(/\r?\n/);
    const customerLines = [];
    let foundCustomerContent = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (
        trimmed.match(/^On .+wrote:?/i) ||
        trimmed.match(/^From:.*Sent:.*To:/i) ||
        trimmed.match(/^----+ ?Original [Mm]essage ?----+/)
      ) {
        if (foundCustomerContent) break;
        continue;
      }

      if (foundCustomerContent && (
        trimmed.match(/^Sent from/i) ||
        trimmed.match(/^Get Outlook/i) ||
        trimmed.match(/^(Regards|Kind regards|Best regards|Thanks|Thank you)[\s,]*$/i)
      )) {
        break;
      }

      if (trimmed.length > 0) {
        customerLines.push(line);
        foundCustomerContent = true;
      }
    }

    let result = customerLines.join('\n');
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/[ \t]+/g, ' ');
    return result.trim();
  }
}

module.exports = GmailEmailExtractor;
