/**
 * src/lib/nfe-signer.ts - Assinatura XMLDSig da NF-e (A1)
 * =========================================================
 * Assina o grupo <infNFe> conforme o Manual de Orientacao do Contribuinte:
 *   - Canonicalizacao: C14N (REC-xml-c14n-20010315)
 *   - Transformacoes:  enveloped-signature + C14N
 *   - Digest:          SHA-1
 *   - Assinatura:      RSA-SHA1
 *   - Reference URI:   #NFe<chave de 44 digitos>
 *   - <Signature> fica logo apos </infNFe>, dentro de <NFe>
 */

import { SignedXml } from 'xml-crypto';
import { carregarCertificado } from './firebase-cert';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

/** Remove indentacao entre tags - a NF-e deve trafegar minificada. */
export function minify(xml: string): string {
  return String(xml)
    .replace(/\r?\n\s*/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

export interface SignedNFe {
  xml: string;
  chave: string;
  certInfo: {
    titular: string;
    cnpj: string;
    validoAte: string;
  };
}

/**
 * Assina um XML de NF-e (elemento raiz <NFe>).
 */
export async function assinarNFe(xmlNFe: string): Promise<SignedNFe> {
  const cert = await carregarCertificado();
  if (!cert) {
    const err = new Error(
      'Certificado digital A1 nao configurado. Faca upload via POST /api/v1/nfe/certificado.'
    );
    (err as any).code = 'CERT_AUSENTE';
    throw err;
  }
  if (cert.info && cert.info.expirado) {
    const err = new Error(
      `Certificado digital A1 expirado em ${cert.info.validoAte}. Renove antes de emitir.`
    );
    (err as any).code = 'CERT_EXPIRADO';
    throw err;
  }

  const xml = minify(xmlNFe);
  const m = xml.match(/Id="(NFe\d{44})"/);
  if (!m) {
    throw new Error('infNFe sem atributo Id="NFe<chave>" - nao eh possivel assinar.');
  }
  const idAttr = m[1];
  const chave = idAttr.slice(3);

  const sig = new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
    uri: `#${idAttr}`,
  });

  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='infNFe']", action: 'after' },
  });

  const assinado = sig.getSignedXml();

  if (!assinado.includes('<Signature')) {
    throw new Error('Falha ao gerar a assinatura digital (Signature ausente).');
  }
  if (!assinado.includes('<X509Certificate>')) {
    throw new Error('Assinatura gerada sem X509Certificate - a SEFAZ rejeitaria (rejeicao 297).');
  }

  console.log(
    `[NFE-SIGN] NF-e ${chave} assinada com certificado de ${cert.info.titular}`
  );
  return {
    xml: assinado,
    chave,
    certInfo: {
      titular: cert.info.titular,
      cnpj: cert.info.cnpj,
      validoAte: cert.info.validoAte,
    },
  };
}
