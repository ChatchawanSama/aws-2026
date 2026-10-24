from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

PDF_DIR = Path("/Users/ar667225/Downloads/AWS-SAA-C03-examtopic-solution 2")
OUT_BANK = Path("tutor/saa_c03_tutor_bank.json")
OUT_PROGRESS = Path("tutor/saa_c03_tutor_progress.json")

QUESTION_RE = re.compile(r"Question #(\d+) Topic (\d+)")
CORRECT_RE = re.compile(r"Correct Answer:([A-Z]+)")
CHOICE_RE = re.compile(r"^([A-E])\. ", re.MULTILINE)


OFFICIAL_DOMAINS = [
    {"key": "secure", "label": "Design Secure Architectures", "weight": 30},
    {"key": "resilient", "label": "Design Resilient Architectures", "weight": 26},
    {"key": "high-performing", "label": "Design High-Performing Architectures", "weight": 24},
    {"key": "cost-optimized", "label": "Design Cost-Optimized Architectures", "weight": 20},
]
AMBIGUOUS_DOMAIN = "Ambiguous — Needs Review"

TASK_DOMAINS = {
    "1.1": "secure",
    "1.2": "secure",
    "1.3": "secure",
    "2.1": "resilient",
    "2.2": "resilient",
    "3.1": "high-performing",
    "3.2": "high-performing",
    "3.3": "high-performing",
    "3.4": "high-performing",
    "3.5": "high-performing",
    "4.1": "cost-optimized",
    "4.2": "cost-optimized",
    "4.3": "cost-optimized",
    "4.4": "cost-optimized",
}

DOMAIN_GOALS = {
    "secure": re.compile(
        r"secure(?:ly|d)?|security|unauthori[sz]ed|restrict(?:ed)? access|access control|"
        r"authentication|authori[sz]ation|encrypt(?:ed|ion)?|compliance|protect sensitive|"
        r"protect (?:the )?data|security vulnerability|traffic inspection|traffic filtering|DDoS",
        re.IGNORECASE,
    ),
    "resilient": re.compile(
        r"high(?:ly)? available|high availability|fault[- ]toleran(?:t|ce)|resilien(?:t|ce|cy)|"
        r"single point of failure|disaster recovery|automatic failover|\bRPO\b|\bRTO\b|"
        r"remain available|decoupl(?:e|ed|ing)|loosely coupled",
        re.IGNORECASE,
    ),
    "high-performing": re.compile(
        r"high[- ]perform(?:ing|ance)|performance|lowest possible latency|low latency|"
        r"single-digit millisecond|millisecond latency|highest throughput|high throughput|"
        r"as quickly as possible|"
        r"real[- ]time|near real[- ]time",
        re.IGNORECASE,
    ),
    "cost-optimized": re.compile(
        r"most cost[- ]effective|cost[- ]effective|lowest cost|least cost|minimi[sz]e(?:s|d|ing)? "
        r"(?:the )?costs?|reduce(?:s|d|ing)? (?:the )?costs?|cost savings|least expensive|"
        r"most economical|cost optimi[sz](?:e|ed|ation)|Cost Explorer|billing cost",
        re.IGNORECASE,
    ),
}

TASK_SIGNALS = {
    "1.1": re.compile(
        r"\bIAM\b|identity center|federat(?:e|ed|ion)|least privilege|root user|\bMFA\b|"
        r"cross-account|service control polic|resource[- ]based polic|bucket policy|"
        r"PrincipalOrg|AWS Organizations|role-based access",
        re.IGNORECASE,
    ),
    "1.2": re.compile(
        r"security group|network ACL|private subnet|VPC endpoint|PrivateLink|\bWAF\b|Shield|"
        r"GuardDuty|Macie|Cognito|Secrets Manager|credential|DDoS|SQL injection|secure application|"
        r"Network Firewall|Gateway Load Balancer|traffic inspection|traffic filtering",
        re.IGNORECASE,
    ),
    "1.3": re.compile(
        r"\bKMS\b|key policy|encrypt(?:ed|ion)?|certificate|\bTLS\b|MFA Delete|Object Lock|"
        r"data (?:access|governance|retention|classification|protection)|key rotation",
        re.IGNORECASE,
    ),
    "2.1": re.compile(
        r"loosely coupled|decoupl(?:e|ed|ing)|event-driven|microservice|stateless|horizontal scaling|"
        r"API Gateway|\bSQS\b|\bSNS\b|EventBridge|Step Functions|\bECS\b|\bEKS\b|Fargate|"
        r"Auto Scaling|load balancer|serverless|read replica|publish/subscribe|workflow orchestration",
        re.IGNORECASE,
    ),
    "2.2": re.compile(
        r"multi-AZ|multiple Availability Zones|failover|backup and restore|pilot light|warm standby|"
        r"active-active|disaster recovery|single point of failure|fault[- ]toleran|Route 53 health check|"
        r"cross-Region replication|readiness check|application recovery controller",
        re.IGNORECASE,
    ),
    "3.1": re.compile(
        r"\bS3\b|\bEFS\b|\bEBS\b|\bFSx\b|Storage Gateway|storage class|Provisioned IOPS|"
        r"multipart upload",
        re.IGNORECASE,
    ),
    "3.2": re.compile(
        r"\bEC2\b|\bLambda\b|\bFargate\b|\bAWS Batch\b|compute workload|instance type|"
        r"placement group|provisioned concurrency|Lambda SnapStart",
        re.IGNORECASE,
    ),
    "3.3": re.compile(
        r"\bRDS\b|Aurora|DynamoDB|ElastiCache|DAX|database workload|database engine|"
        r"database connection|RDS Proxy|capacity units|read replica",
        re.IGNORECASE,
    ),
    "3.4": re.compile(
        r"CloudFront|Global Accelerator|Direct Connect|\bVPN\b|load balancer|Route 53|"
        r"network topology|network architecture|bandwidth|Transit Gateway",
        re.IGNORECASE,
    ),
    "3.5": re.compile(
        r"Athena|Lake Formation|QuickSight|Kinesis|Data Firehose|Glue|DataSync|\bEMR\b|"
        r"data ingestion|data transformation|streaming data|data lake|Transfer Acceleration|"
        r"Transfer Family|Snowball",
        re.IGNORECASE,
    ),
    "4.1": re.compile(
        r"\bS3\b|\bEFS\b|\bEBS\b|\bFSx\b|Glacier|Storage Gateway|storage|archive|backup",
        re.IGNORECASE,
    ),
    "4.2": re.compile(
        r"\bEC2\b|\bLambda\b|\bFargate\b|compute|Spot Instance|Reserved Instance|Savings Plan|"
        r"instance family|instance size|Auto Scaling",
        re.IGNORECASE,
    ),
    "4.3": re.compile(
        r"\bRDS\b|Aurora|DynamoDB|ElastiCache|database|capacity units|read replica|serverless",
        re.IGNORECASE,
    ),
    "4.4": re.compile(
        r"NAT Gateway|Direct Connect|\bVPN\b|VPC peering|Transit Gateway|CloudFront|"
        r"Global Accelerator|network transfer|bandwidth|VPC endpoint",
        re.IGNORECASE,
    ),
}

TASKS_REQUIRING_DOMAIN_GOAL = {
    "3.1",
    "3.2",
    "3.3",
    "3.4",
    "4.1",
    "4.2",
    "4.3",
    "4.4",
}


def pdf_sort_key(path: Path) -> int:
    match = re.search(r"Page (\d+)", path.name)
    return int(match.group(1)) if match else 0


def read_texts() -> list[dict[str, Any]]:
    import pdfplumber

    texts = []
    for pdf_path in sorted(PDF_DIR.glob("AWS Certified Solutions Architect - Associate SAA-C03 Exam - Free Exam Q&As, Page * _ ExamTopics.pdf"), key=pdf_sort_key):
        with pdfplumber.open(pdf_path) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        texts.append({"source": str(pdf_path), "page_set": pdf_sort_key(pdf_path), "text": text})
    return texts


def clean_text(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if "examtopics.com/exams/" in line:
            continue
        if re.match(r"^\d+/\d+/\d+,", line):
            continue
        if re.match(r"^\d+/\d+$", line.strip()):
            continue
        if line.startswith("Community vote distribution"):
            continue
        if re.match(r"^[A-E]{1,3} \(\d+%\)", line.strip()):
            continue
        lines.append(line.rstrip())
    return "\n".join(lines)


def parse_choices(block: str) -> dict[str, str]:
    markers = list(CHOICE_RE.finditer(block))
    choices: dict[str, str] = {}
    for idx, marker in enumerate(markers):
        start = marker.end()
        end = markers[idx + 1].start() if idx + 1 < len(markers) else len(block)
        value = block[start:end].strip()
        value = re.sub(r"\s*Most Voted\s*$", "", value).strip()
        choices[marker.group(1)] = " ".join(value.split())
    return choices


def classify_question(prompt: str, choices: dict[str, str]) -> str:
    lower = prompt.lower()
    if "choose two" in lower or "choose three" in lower or "combination of" in lower:
        return "multiple_select_choice"
    if set(choices) <= {"A", "B"} and any(v.lower() in {"true", "false"} for v in choices.values()):
        return "true_false"
    return "single_select_choice"


def classify_exam_domain(
    prompt: str, choices: dict[str, str], correct_answer: str
) -> dict[str, object]:
    correct_text = " ".join(choices.get(letter, "") for letter in correct_answer)
    evidence = f"{prompt} {correct_text}"
    matched_goals = {
        domain for domain, pattern in DOMAIN_GOALS.items() if pattern.search(prompt)
    }
    task_scores: Counter[str] = Counter()

    for task, pattern in TASK_SIGNALS.items():
        domain = TASK_DOMAINS[task]
        if task in TASKS_REQUIRING_DOMAIN_GOAL and domain not in matched_goals:
            continue
        if pattern.search(evidence):
            task_scores[task] += 3
    for task, domain in TASK_DOMAINS.items():
        if domain in matched_goals:
            task_scores[task] += 4 if domain == "cost-optimized" else 3

    domain_scores = Counter()
    for task, score in task_scores.items():
        domain = TASK_DOMAINS[task]
        domain_scores[domain] = max(domain_scores[domain], score)

    ranked_domains = domain_scores.most_common()
    best_score = ranked_domains[0][1] if ranked_domains else 0
    runner_up = ranked_domains[1][1] if len(ranked_domains) > 1 else 0
    is_ambiguous = len(matched_goals) > 1 or best_score < 3 or best_score - runner_up < 2
    candidate_tasks = sorted(
        task for task, score in task_scores.items() if score >= max(best_score - 1, 2)
    )

    if is_ambiguous:
        return {
            "domain_key": "ambiguous",
            "domain": AMBIGUOUS_DOMAIN,
            "exam_task": None,
            "classification_status": "ambiguous",
            "candidate_tasks": candidate_tasks,
        }

    domain_key = ranked_domains[0][0]
    domain = next(item for item in OFFICIAL_DOMAINS if item["key"] == domain_key)
    domain_tasks = [
        (task, score)
        for task, score in task_scores.items()
        if TASK_DOMAINS[task] == domain_key
    ]
    top_task_score = max(score for _, score in domain_tasks)
    top_tasks = sorted(task for task, score in domain_tasks if score == top_task_score)
    return {
        "domain_key": domain_key,
        "domain": domain["label"],
        "exam_task": top_tasks[0] if len(top_tasks) == 1 else None,
        "classification_status": "classified",
        "candidate_tasks": top_tasks,
    }


def parse_questions(texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    questions = []
    for item in texts:
        text = clean_text(item["text"])
        matches = list(QUESTION_RE.finditer(text))
        for idx, match in enumerate(matches):
            start = match.start()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
            block = text[start:end].strip()
            answer_match = CORRECT_RE.search(block)
            if not answer_match:
                continue
            head_end = match.end() - start
            answer_start = answer_match.start()
            body = block[head_end:answer_start].strip()
            correct = answer_match.group(1)
            choices = parse_choices(body)
            first_choice = CHOICE_RE.search(body)
            prompt = body[: first_choice.start()].strip() if first_choice else body
            prompt = " ".join(prompt.split())
            domain_info = classify_exam_domain(prompt, choices, correct)
            questions.append(
                {
                    "id": int(match.group(1)),
                    "topic": int(match.group(2)),
                    "source_pdf": item["source"],
                    "source_page_set": item["page_set"],
                    "prompt": prompt,
                    "choices": choices,
                    "correct_answer": correct,
                    "question_type": classify_question(prompt, choices),
                    **domain_info,
                }
            )
    return sorted(questions, key=lambda q: q["id"])


def build_bank_document(questions: list[dict[str, Any]]) -> dict[str, object]:
    return {
        "exam_domains": OFFICIAL_DOMAINS,
        "ambiguous_domain": AMBIGUOUS_DOMAIN,
        "questions": questions,
    }


def main() -> None:
    questions = parse_questions(read_texts())
    OUT_BANK.write_text(
        json.dumps(build_bank_document(questions), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if not OUT_PROGRESS.exists():
        OUT_PROGRESS.write_text(
            json.dumps({"asked": [], "wrong": {}, "correct": {}, "last_question_id": None}, indent=2),
            encoding="utf-8",
        )
    counts = {
        "questions": len(questions),
        "ids_min": questions[0]["id"] if questions else None,
        "ids_max": questions[-1]["id"] if questions else None,
        "topics": Counter(q["topic"] for q in questions),
        "types": Counter(q["question_type"] for q in questions),
        "domains": Counter(q["domain"] for q in questions),
        "missing_choices": [q["id"] for q in questions if not q["choices"]],
    }
    print(json.dumps(counts, ensure_ascii=False, indent=2, default=dict))


if __name__ == "__main__":
    main()
