export const paragraphs = body => body.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
