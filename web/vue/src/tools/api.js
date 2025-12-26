// global window.CONFIG

const config = window.CONFIG.ui;

// Detect if we're running on Replit (HTTPS) and use relative paths
const isReplit = window.location.hostname.includes('replit');
const isHttps = window.location.protocol === 'https:';

let basePath, restPath, wsPath;

if (isReplit || isHttps) {
  // Use relative paths for Replit - the proxy handles routing
  basePath = window.location.origin + '/';
  restPath = basePath + 'api/';
  wsPath = `wss://${window.location.host}/api`;
} else {
  const endpoint = `${config.host}${config.port === 80 ? '' : `:${config.port}`}${config.path}`;
  
  // rest API path
  if(config.ssl) {
    basePath = `https://${endpoint}`;
  } else {
    basePath = `http://${endpoint}`;
  }
  
  restPath = basePath + 'api/';
  
  // ws API path
  if(config.ssl) {
    wsPath = `wss://${endpoint}api`;
  } else {
    wsPath = `ws://${endpoint}api`;
  }
}

export {
  wsPath,
  restPath,
  basePath
};
