import React, { useEffect, useRef } from 'react';
import { FiPaperclip, FiImage } from 'react-icons/fi';

const GmailEmailRenderer = ({
  htmlContent,
  textContent,
  attachments = [],
  embeddedImages = [],
  className = ''
}) => {
  const iframeRef = useRef(null);

  const sanitizeHtml = (html) => {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
    dangerousTags.forEach(tag => {
      const elements = doc.getElementsByTagName(tag);
      while (elements.length > 0) elements[0].remove();
    });

    const allElements = doc.getElementsByTagName('*');
    for (let i = 0; i < allElements.length; i++) {
      const element = allElements[i];
      const attributesToRemove = [];
      for (let j = 0; j < element.attributes.length; j++) {
        const attr = element.attributes[j];
        const attrName = attr.name.toLowerCase();
        if (attrName.startsWith('on') ||
            attrName.startsWith('data-') ||
            (attrName === 'href' && attr.value.startsWith('javascript:')) ||
            (attrName === 'src' && attr.value.startsWith('javascript:'))) {
          attributesToRemove.push(attr.name);
        }
      }
      attributesToRemove.forEach(attr => element.removeAttribute(attr));
    }

    const images = doc.getElementsByTagName('img');
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const src = img.getAttribute('src');
      if (src && src.startsWith('cid:')) {
        const cid = src.replace('cid:', '');
        const embeddedImage = embeddedImages.find(ei =>
          ei.contentId === cid || ei.contentId === `<${cid}>` || ei.cid === cid || ei.cid === `<${cid}>`
        );
        if (embeddedImage && (embeddedImage.dataUrl || embeddedImage.url)) {
          img.setAttribute('src', embeddedImage.dataUrl || embeddedImage.url);
        } else {
          img.style.display = 'none';
        }
      }
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    }

    const links = doc.getElementsByTagName('a');
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const href = link.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('#')) {
        link.setAttribute('href', 'https://' + href);
      }
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }

    return doc.body.innerHTML;
  };

  const getEmailStyles = () => `
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px; line-height: 1.5; color: #202124; background-color: transparent;
    }
    p { margin: 0 0 12px 0; }
    p:last-child { margin-bottom: 0; }
    h1, h2, h3, h4, h5, h6 { margin: 16px 0 8px 0; font-weight: 600; color: #202124; }
    h1 { font-size: 20px; } h2 { font-size: 18px; } h3 { font-size: 16px; }
    ul, ol { margin: 8px 0; padding-left: 24px; }
    li { margin: 4px 0; }
    a { color: #1a73e8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; border: 0; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { padding: 8px; border: 1px solid #dadce0; }
    blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #dadce0; color: #5f6368; }
    .gmail_quote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #dadce0; }
    hr { border: none; border-top: 1px solid #dadce0; margin: 16px 0; }
    pre { background-color: #f8f9fa; padding: 12px; border-radius: 4px; overflow-x: auto; font-family: monospace; font-size: 13px; }
    code { background-color: #f8f9fa; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 13px; }
    img[width="1"][height="1"], img[width="0"][height="0"] { display: none; }
  `;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !htmlContent) return;

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const sanitizedHtml = sanitizeHtml(htmlContent);

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getEmailStyles()}</style></head><body>${sanitizedHtml}</body></html>`);
    doc.close();

    const resizeIframe = () => { iframe.style.height = doc.body.scrollHeight + 'px'; };
    resizeIframe();

    const images = doc.getElementsByTagName('img');
    const imgArray = Array.from(images);
    imgArray.forEach(img => { img.onload = resizeIframe; });

    return () => {
      imgArray.forEach(img => { img.onload = null; });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlContent, embeddedImages]);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes <= 0) return '';
    const b = Number(bytes);
    if (!b || b <= 0) return '';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return Math.round(b / Math.pow(1024, i) * 10) / 10 + ' ' + sizes[i];
  };

  const isHtmlContent = (content) => {
    if (!content) return false;
    return /<[a-z][\s\S]*>/i.test(content);
  };

  if (htmlContent && isHtmlContent(htmlContent)) {
    return (
      <div className={`gmail-email-renderer ${className}`}>
        <iframe
          ref={iframeRef}
          className="w-full border-0"
          style={{ minHeight: '100px' }}
          title="Email Content"
          sandbox="allow-same-origin"
        />
        {attachments && attachments.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <FiPaperclip className="mr-2" />
              Attachments ({attachments.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {attachments.map((attachment, index) => (
                <a key={index} href={attachment.url || '#'} target="_blank" rel="noopener noreferrer"
                  className="flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">
                  {attachment.mimetype?.startsWith('image/') ? <FiImage className="mr-2 text-blue-500" /> : <FiPaperclip className="mr-2 text-gray-500" />}
                  <span className="truncate max-w-[150px]">{attachment.filename || `Attachment ${index + 1}`}</span>
                  {attachment.size && <span className="ml-2 text-xs text-gray-500">({formatFileSize(attachment.size)})</span>}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const renderPlainText = (text) => {
    if (!text) return <p className="text-gray-500 italic">No content</p>;
    const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g;
    const parts = text.split(urlPattern);
    const matches = text.match(urlPattern) || [];
    return (
      <div className="whitespace-pre-wrap break-words text-sm text-gray-900">
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            {part}
            {matches[index] && (
              <a href={matches[index].startsWith('www.') ? `https://${matches[index]}` : matches[index]}
                target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {matches[index]}
              </a>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className={`gmail-email-renderer ${className}`}>
      {renderPlainText(textContent || htmlContent)}
      {attachments && attachments.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
            <FiPaperclip className="mr-2" />
            Attachments ({attachments.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <a key={index} href={attachment.url || '#'} target="_blank" rel="noopener noreferrer"
                className="flex items-center px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">
                <FiPaperclip className="mr-2 text-gray-500" />
                <span className="truncate max-w-[150px]">{attachment.filename || `Attachment ${index + 1}`}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GmailEmailRenderer;
