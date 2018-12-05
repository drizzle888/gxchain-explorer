import Promise from 'bluebird';
import { Apis } from 'gxbjs-ws';
import { ChainStore } from 'gxbjs';
import Immutable from 'immutable';
import superagent from 'superagent';

/**
 * get account information by name
 * @param account_name
 */
const fetch_account = (account_name) => {
    return Apis.instance().db_api().exec('get_account_by_name', [account_name]);
};

const fetch_full_account = (account) => {
    return Apis.instance().db_api().exec('get_full_accounts', [[account], true]);
};

/**
 * fetch account balance of GXS by account name or id
 * @param account_name
 * @returns {bluebird}
 */
const fetch_account_balance = (account_name) => {
    return new Promise((resolve, reject) => {
        resolve(fetch_account(account_name).then((account) => {
            return Apis.instance().db_api().exec('get_account_balances', [account.id, []]).then(function (balances) {
                return balances;
            });
        }).catch((ex) => {
            reject(ex);
        }));
    });
};

/**
 * 获取区块信息
 * @param block_height 区块高度
 */
const fetch_block = function (block_height) {
    return new Promise(function (resolve, reject) {
        return Apis.instance().db_api().exec('get_block', [parseInt(block_height)]).then(function (block) {
            if (!block) {
                resolve(null);
            } else {
                resolve(block);
            }
        }).catch(function (ex) {
            reject(ex);
        });
    });
};

/**
 * 资产信息
 * @param asset_name
 */
const fetch_asset = function (asset_name) {
    return new Promise(function (resolve, reject) {
        return Apis.instance().db_api().exec('lookup_asset_symbols', [[asset_name]]).then(function (assets) {
            let asset = assets && assets.length > 0 ? assets[0] : {};
            if (asset.id) {
                Apis.instance().db_api().exec('get_objects', [[asset.dynamic_asset_data_id, asset.issuer]]).then(objs => {
                    asset.detail = objs[0];
                    asset.issuer = objs[1];
                    resolve(asset);
                });
            } else {
                resolve(asset);
            }
        }).catch(function (ex) {
            reject(ex);
        });
    });
};

/**
 * 链上资产列表
 */
const fetch_assets = function () {
    return new Promise(function (resolve, reject) {
        return Apis.instance().db_api().exec('list_assets', ['A', 100]).then(function (assets) {
            let ids = [];
            assets.forEach(asset => {
                ids.push(asset.dynamic_asset_data_id);
                ids.push(asset.issuer);
            });
            Apis.instance().db_api().exec('get_objects', [ids]).then(objs => {
                assets.forEach((asset, i) => {
                    asset.detail = objs[2 * i];
                    asset.issuer = objs[2 * i + 1];
                });
                resolve(assets);
            });
        }).catch(function (ex) {
            reject(ex);
        });
    });
};

/**
 * 公信股供应量查询接口
 */
const gxs_supply = function () {
    return new Promise(function (resolve, reject) {
        return Apis.instance().db_api().exec('get_objects', [['2.3.1']]).then(function (resps) {
            resolve(resps[0]);
        }).catch((ex) => {
            reject(ex);
        });
    });
};

/**
 * 获取产品信息
 * @param prod_id
 */
const fetch_product = function (prod_id) {
    return new Promise(function (resolve, reject) {
        let prod = ChainStore.objects_by_id.get(prod_id);
        if (prod) {
            prod = prod.toJS();
            prod.schema_contexts = prod.schema_contexts.map(function (schema) {
                if (typeof schema.schema_context === 'string') {
                    schema.schema_context = JSON.parse(schema.schema_context);
                }
                return schema;
            });
            resolve(prod);
        } else {
            return Apis.instance().db_api().exec('get_objects', [[prod_id]]).then(function (resp) {
                if (!resp || resp.length === 0) {
                    reject(new Error('product not found'));
                } else {
                    let prod = Object.assign({schema_contexts: []}, resp[0]);
                    prod.schema_contexts = prod.schema_contexts.map(function (schema) {
                        if (typeof schema.schema_context === 'string') {
                            schema.schema_context = JSON.parse(schema.schema_context);
                        }
                        return schema;
                    });
                    ChainStore.objects_by_id.set(prod_id, Immutable.fromJS(prod));
                    resolve(prod);
                }
            }).catch(function (ex) {
                reject(ex);
            });
        }
    });
};

const fetch_candidates = function () {
    let filtered_nodes = [
        'aaron',
        'caitlin',
        'kairos',
        'sakura',
        'taffy',
        'miner1',
        'miner2',
        'miner3',
        'miner4',
        'miner5',
        'miner6',
        'miner7',
        'miner8',
        'miner9',
        'miner10',
        'miner11',
        'hrrs',
        'dennis1',
        'david12',
        'marks-lee',
        'robin-green'
    ];
    return Apis.instance()
    .db_api()
    .exec('get_trust_nodes', []).then(nodes => {
        return Promise.all([
            Apis.instance().db_api().exec('get_objects', [nodes]),
            superagent.get('https://raw.githubusercontent.com/gxchain/TrustNodes/master/trustNodes.json')
        ]).then(results => {
            let accounts = results[0];
            let trustNodeOffChainInfo = JSON.parse(results[1].text).list;
            let candidates = accounts.map(a => {
                let info = trustNodeOffChainInfo.find(t => t.accountName === a.name);
                return {
                    id: a.id,
                    account: a.name,
                    comments: info && info.nodeName || null,
                    logo: info && info.logo || null,
                    votes: 0
                };
            });
            candidates = candidates.filter(c => {
                return filtered_nodes.indexOf(c.account) === -1;
            });
            let promises = candidates.map(c => {
                return Apis.instance().db_api().exec('get_witness_by_account', [c.id]);
            });
            return Promise.all(promises).then(witnesses => {
                candidates = candidates.map((c, i) => {
                    c.votes = witnesses[i].total_votes;
                    return c;
                }).sort((a, b) => {
                    return b.votes - a.votes;
                });
                return candidates;
            });
        });
    }).catch(ex => {
        console.error(ex);
    });
};

export default {
    gxs_supply,
    fetch_block,
    fetch_asset,
    fetch_assets,
    fetch_account,
    fetch_full_account,
    fetch_account_balance,
    fetch_product,
    fetch_candidates
};
