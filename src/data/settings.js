// Per-account settings in NerdStorage.
import { AccountStorageQuery, AccountStorageMutation } from 'nr1';
import { mergeConfig } from '../config/attributes';

const COLLECTION = 'workflow-trace-explorer';
const DOC = 'config';

export async function loadConfig(accountId) {
  try {
    const { data } = await AccountStorageQuery.query({
      accountId: Number(accountId),
      collection: COLLECTION,
      documentId: DOC
    });
    return mergeConfig(data);
  } catch (e) {
    return mergeConfig(null);
  }
}

export async function saveConfig(accountId, config) {
  await AccountStorageMutation.mutate({
    accountId: Number(accountId),
    actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
    collection: COLLECTION,
    documentId: DOC,
    document: config
  });
}
