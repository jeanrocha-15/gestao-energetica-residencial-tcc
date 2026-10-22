/** Valida o endereço de autorização do consumidor, rejeitando a plataforma de desenvolvedor e segredos na URL. */
export function authorizationPage(address:string) {
  const url=new URL(address);
  const domains=['tuya.com','tuyacn.com','tuyaus.com','tuyaeu.com','tuyain.com'];
  if (url.protocol!=='https:' || url.username || url.password || !domains.some(domain=>url.hostname===domain || url.hostname.endsWith('.'+domain)) || ['iot.tuya.com','platform.tuya.com','developer.tuya.com'].includes(url.hostname)) throw new Error('Configure a página H5 oficial de autorização do consumidor, não a Developer Platform.');
  // URLs H5 podem manter parâmetros em uma rota após #; nenhum segredo é permitido em qualquer variante.
  const fragment=new URLSearchParams(url.hash.split('?').slice(1).join('?'));
  for (const params of [url.searchParams,fragment]) for (const key of params.keys()) if (/secret|password|token|^code$|^uid$|^identifier$/i.test(key)) throw new Error('A URL de autorização não pode conter segredos ou identificadores de conta.');
  return url;
}

/** Monta o redirecionamento preservando o aplicativo da URL H5 e acrescentando somente parâmetros públicos do OAuth. */
export function authorizationAddress(address:string,clientId:string,callback:string,state:string) {
  const url=authorizationPage(address);
  const values={client_id:clientId,redirect_uri:callback,response_type:'code',state};
  for (const [key,value] of Object.entries(values)) url.searchParams.set(key,value);
  // Mantém também os parâmetros de roteadores H5 quando a plataforma fornecer uma URL com #/rota.
  if (url.hash.startsWith('#/')) {
    const [route,...query]=url.hash.slice(1).split('?'),params=new URLSearchParams(query.join('?'));
    for (const [key,value] of Object.entries(values)) params.set(key,value);
    url.hash=route+'?'+params.toString();
  }
  return url.href;
}
