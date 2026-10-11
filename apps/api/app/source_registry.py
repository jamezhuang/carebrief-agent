"""官网来源名单。添加机构前，请核对其真实官网域名。"""

OFFICIAL_SITES = {
    "pumch.cn": "北京协和医院",
    "pkufh.com": "北京大学第一医院",
    "zy91.com": "浙江大学医学院附属第一医院",
    "wchscu.cn": "四川大学华西医院",
    "fahsysu.org.cn": "中山大学附属第一医院",
    "qiluhospital.com": "山东大学齐鲁医院",
    "dyyy.xjtu.edu.cn": "西安交通大学第一附属医院",
    "nhc.gov.cn": "国家卫生健康委员会",
    "chinacdc.cn": "中国疾病预防控制中心",
}


def normalize_host(host: str) -> str:
    host = host.strip().lower().rstrip(".")
    return host[4:] if host.startswith("www.") else host
