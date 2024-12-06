const crypto = require('crypto');
const express = require('express');
const app = express();
app.use(express.json());
const SearchMapper = require('../db/shop/SearchImageMapper');

// LSH 버킷 저장소
const lshBuckets = new Map();

//버킷 수
const numBuckets = 30;

// Hamming Distance 계산
function calculateHammingDistance(hash1, hash2) {
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] !== hash2[i]) distance++;
    }
    return distance;
}

// SimHash 계산
function calculateSimHash(data) {
    const vector = Array(128).fill(0);
    const tokens = data.split(' '); // 데이터를 공백 기준으로 나눔

    tokens.forEach(token => {
        const hash = crypto.createHash('md5').update(token).digest('hex');
        const binaryHash = BigInt(`0x${hash}`).toString(2).padStart(128, '0');

        for (let i = 0; i < 128; i++) {
            vector[i] += binaryHash[i] === '1' ? 1 : -1;
        }
    });

    return vector.map(v => (v > 0 ? '1' : '0')).join('');
}

module.exports = {
    // LSH 버킷 초기화
    async initializeLSH() {
        console.log("LSH 초기화 시작...");
        const items = await SearchMapper.selectAllImageHash(); // DB에서 데이터 가져오기
        items.forEach(item => addToLSH(item.image_uuid, item.image_hash_code)); // 데이터 추가
        console.log("LSH 초기화 완료!");
    },


    // LSH 검색 2.0 - Set 자료형을 이용하여 탐색값에서 중복 제거
    async searchLSH(hashValue) {
        const hashValue = calculateSimHash(hashValue); // 입력 데이터를 SimHash로 변환
        let resultsMap = new Map();
        for (let i = 0; i < numBuckets; i++) {
            const bucketKey = crypto.createHash('md5').update(`${i}_${hashValue}`).digest('hex').substring(0, 8);
            if (lshBuckets.has(bucketKey)) {

                lshBuckets.get(bucketKey).forEach(item => {
                    if (!resultsMap.has(item.itemId)) {
                        resultsMap.set(item.itemId, item);
                    }
                });
            }
        }
        const uniqueResults = Array.from(resultsMap.values());

        // Hamming Distance 계산
        const candidates = uniqueResults.map(item => ({
            ...item,
            hammingDistance: calculateHammingDistance(item.hashValue, hashValue)
        }));

        // 거리 기준으로 정렬 후 상위 10개 반환
        //return candidates.sort((a, b) => a.hammingDistance - b.hammingDistance).slice(0, 10);
        return candidates.sort((a, b) => a.hammingDistance - b.hammingDistance);
    },

    // LSH 버킷에 데이터 추가
    addToLSH(itemId, data) {
        const hashValue = calculateSimHash(data);
        for (let i = 0; i < numBuckets; i++) {
            const bucketKey = crypto.createHash('md5').update(`${i}_${hashValue}`).digest('hex').substring(0, 8);
            if (!lshBuckets.has(bucketKey)) {
                lshBuckets.set(bucketKey, []);
            }
            lshBuckets.get(bucketKey).push({ itemId, hashValue });
        }
    },

    removeFromLSH(itemId, hashValue) {
        for (let i = 0; i < numBuckets; i++) {
            const bucketKey = crypto.createHash('md5').update(`${i}_${hashValue}`).digest('hex').substring(0, 8);
            if (lshBuckets.has(bucketKey)) {
                const bucket = lshBuckets.get(bucketKey);
                const index = bucket.findIndex(item => item.itemId === itemId);
                if (index !== -1) {
                    bucket.splice(index, 1); // 데이터 제거
                    if (bucket.length === 0) {
                        lshBuckets.delete(bucketKey); // 비어 있는 버킷 제거
                    }
                }
            }
        }
    }

};