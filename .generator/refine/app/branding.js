function domainBranding(model, frontendApplication) {
    const domainName = frontendApplication?.domain
        || model.domain
        || (model.domains?.length === 1 ? model.domains[0].name : undefined)
        || frontendApplication?.name
        || 'Application';
    const words = String(domainName)
        .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
        .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
    const initials = words.map((word) => Array.from(word)[0].toUpperCase()).join('') || 'A';
    const title = words.join(' ') || 'Application';
    const fontSize = Math.min(22, 24 / (Array.from(initials).length * 0.72));
    const escapeXml = (value) => value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#24684b"/>
  <text x="16" y="16" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700" font-size="${fontSize.toFixed(2)}" letter-spacing="0" fill="#fff">${escapeXml(initials)}</text>
</svg>\n`;
    return { domainName, title, initials, icon };
}

module.exports = { domainBranding };
