import net from 'node:net';
if (process.env.HTNQ_F00_ISOLATED !== '1') throw new Error('F00 network guard requires the isolated runner');
const local = host => ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(host);
const blocked = () => { throw new Error('F00 isolation blocked a non-loopback network connection'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let input = Array.isArray(args[0]) ? args[0] : args;
  let options = input[0];
  if (typeof options === 'object' && options !== null) {
    if (options.path) {
      if (String(options.path).startsWith('\\\\') && !String(options.path).startsWith('\\\\.\\pipe\\')) blocked();
    } else if (!local(options.host ?? 'localhost')) blocked();
  } else if (typeof options === 'number' || /^\d+$/.test(String(options))) {
    if (!local(typeof input[1] === 'string' ? input[1] : 'localhost')) blocked();
  } else if (typeof options === 'string' && options.startsWith('\\\\') && !options.startsWith('\\\\.\\pipe\\')) blocked();
  return connect.apply(this, args);
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['http:', 'https:'].includes(url.protocol) || !local(url.hostname)) return Promise.reject(new Error('F00 isolation blocked a non-loopback fetch'));
  return nativeFetch(input, init);
};
