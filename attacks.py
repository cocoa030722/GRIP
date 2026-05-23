import requests, time

BASE_URL = "http://localhost:3000/api/auth"
TARGET_EMAIL = f"victi_{int(time.time())}@test.kr"

# 1. 공격 대상(희생자) 계정을 먼저 확실하게 생성해 둡니다. (이미 있으면 에러나지만 무시됨)
requests.post(f"{BASE_URL}/register", json={
    "email": TARGET_EMAIL,
    "password": "RealPassword123!",
    "role": "consumer"
})

for i in range(30):
    r = requests.post(f"{BASE_URL}/login", json={
        "email": TARGET_EMAIL,
        "password": f"wrong{i}"
    })
    print(f"#{i+1}: {r.status_code}")
    time.sleep(0.1)