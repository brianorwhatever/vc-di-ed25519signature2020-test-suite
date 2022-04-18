/*!
 * Copyright (c) 2022 Digital Bazaar, Inc. All rights reserved.
 */

const vc = require('@digitalbazaar/vc');
const canonicalize = require('canonicalize');
const {createSign, generateKeyPair} = require('crypto');
const {join} = require('path');
const {promisify} = require('util');
const {
  cloneJSON,
  getDiDKey,
  writeJSON,
} = require('./helpers');
const credential = require('./testVC');
const Ed25519Signature2020 = require('./TestEd25519Signature2020');
const documentLoader = require('./documentLoader');
const {hashDigest} = require('./hashDigest');

const generateKeyPairAsync = promisify(generateKeyPair);
const credentialsPath = join(process.cwd(), 'credentials');

// this will generate the signed VCs for the test
const main = async () => {
  if(!process.env.CLIENT_SECRET_DB) {
    throw new Error(`ENV variable CLIENT_SECRET_DB is required.`);
  }
  console.log('generating credentials');
  const {methodFor} = await getDiDKey();
  const key = methodFor({purpose: 'capabilityInvocation'});
  const {path, data} = await _validVC(key);
  // use copies of the validVC in other tests
  const validVC = data;
  // create all of the other vcs once
  const vcs = await Promise.all([
    _incorrectCodec(validVC),
    _incorrectDigest(key),
    _incorrectCanonize(key),
    _incorrectSigner(key),
    // make sure the validVC is in the list of VCs
    {path, data}
  ]);
  console.log('writing VCs to /credentialss');
  await Promise.all(vcs.map(({path, data}) => writeJSON({path, data})));
  console.log(`${vcs.length} credentials generated`);
};

function _incorrectCodec(credential) {
  const copy = cloneJSON(credential);
  // break the did key verification method into parts
  const parts = copy.proof.verificationMethod.split(':');
  // pop off the last part and remove the opening z
  const last = parts.pop().substr(1);
  // re-add the key material at the end
  parts.push(last);
  copy.proof.verificationMethod = parts.join(':');
  return {path: `${credentialsPath}/incorrectCodec.json`, data: copy};
}

async function _incorrectSigner(key) {
  const rsaKeyPair = await generateKeyPairAsync('rsa', {modulusLength: 4096});
  const suite = new Ed25519Signature2020({key});
  suite.sign = async ({verifyData, proof}) => {
    const sign = createSign('rsa-sha256');
    sign.write(verifyData);
    sign.end();
    // replace the proofValue with a signature generated from another key
    proof.proofValue = sign.sign(rsaKeyPair.privateKey, 'base64');
    return proof;
  };

  const signedVC = await vc.issue({
    credential: cloneJSON(credential),
    suite,
    documentLoader
  });

  return {path: `${credentialsPath}/rsaSigned.json`, data: signedVC};
}

async function _incorrectCanonize(key) {
  const suite = new Ed25519Signature2020({key});
  // canonize is expected to be async
  suite.canonize = async input => {
    // this will canonize using JCS
    return canonicalize(input);
  };
  const signedVC = await vc.issue({
    credential: cloneJSON(credential),
    suite,
    documentLoader
  });
  return {path: `${credentialsPath}/canonizeJCS.json`, data: signedVC};
}

async function _incorrectDigest(key) {
  const suite = new Ed25519Signature2020({
    key,
    hash: hashDigest({algorithm: 'sha512'})
  });
  const signedVC = await vc.issue({
    credential: cloneJSON(credential),
    suite,
    documentLoader
  });
  return {path: `${credentialsPath}/digestSha512.json`, data: signedVC};
}

async function _validVC(key) {
  const suite = new Ed25519Signature2020({key});
  const signedVC = await vc.issue({
    credential: cloneJSON(credential),
    suite,
    documentLoader
  });
  return {path: `${credentialsPath}/validVC.json`, data: signedVC};
}

// run main by calling node ./vc-generator
main();