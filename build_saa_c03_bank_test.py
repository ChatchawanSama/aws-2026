import unittest

from build_saa_c03_bank import (
    AMBIGUOUS_DOMAIN,
    OFFICIAL_DOMAINS,
    build_bank_document,
    classify_exam_domain,
)


class ExamDomainClassificationTest(unittest.TestCase):
    def classify(self, prompt: str, correct_choice: str) -> dict[str, object]:
        return classify_exam_domain(prompt, {"A": correct_choice}, "A")

    def test_classifies_secure_access_by_task_intent(self) -> None:
        result = self.classify(
            "Restrict access to an S3 bucket to accounts in one AWS Organization.",
            "Use the aws:PrincipalOrgID condition in the bucket policy.",
        )

        self.assertEqual(result["domain_key"], "secure")
        self.assertEqual(result["exam_task"], "1.1")

    def test_classifies_fault_tolerance_as_resilient(self) -> None:
        result = self.classify(
            "The application must remain available after an Availability Zone failure with automatic failover.",
            "Deploy the application across multiple Availability Zones.",
        )

        self.assertEqual(result["domain_key"], "resilient")
        self.assertEqual(result["exam_task"], "2.2")

    def test_classifies_database_latency_as_high_performing(self) -> None:
        result = self.classify(
            "A database workload needs single-digit millisecond latency and high read throughput.",
            "Use DynamoDB with DAX.",
        )

        self.assertEqual(result["domain_key"], "high-performing")
        self.assertEqual(result["exam_task"], "3.3")

    def test_classifies_task_specific_analytics_without_generic_service_voting(self) -> None:
        result = self.classify(
            "JSON logs in S3 must be queried on demand with minimal operational overhead.",
            "Use Amazon Athena directly with Amazon S3.",
        )

        self.assertEqual(result["domain_key"], "high-performing")
        self.assertEqual(result["exam_task"], "3.5")

    def test_security_goal_outweighs_generic_load_balancer_signal(self) -> None:
        result = self.classify(
            "A public application must detect and protect against large-scale DDoS attacks.",
            "Enable AWS Shield Advanced on the Elastic Load Balancer.",
        )

        self.assertEqual(result["domain_key"], "secure")
        self.assertEqual(result["exam_task"], "1.2")

    def test_performance_goal_outweighs_generic_serverless_signal(self) -> None:
        result = self.classify(
            "The website must handle millions of requests with millisecond latency.",
            "Use CloudFront, API Gateway, Lambda, and DynamoDB.",
        )

        self.assertEqual(result["domain_key"], "high-performing")

    def test_classifies_loose_coupling_from_the_architecture_pattern(self) -> None:
        result = self.classify(
            "Orders must be processed in sequence without coupling the API to the processor.",
            "Send orders to an SQS FIFO queue that invokes AWS Lambda.",
        )

        self.assertEqual(result["domain_key"], "resilient")
        self.assertEqual(result["exam_task"], "2.1")

    def test_classifies_explicit_storage_cost_goal(self) -> None:
        result = self.classify(
            "Choose the most cost-effective long-term archive for data that is rarely retrieved.",
            "Use S3 Glacier Deep Archive.",
        )

        self.assertEqual(result["domain_key"], "cost-optimized")
        self.assertEqual(result["exam_task"], "4.1")

    def test_marks_weak_signal_question_ambiguous(self) -> None:
        result = self.classify(
            "Which solution meets these requirements?",
            "Run the application on Amazon EC2.",
        )

        self.assertEqual(result["domain_key"], "ambiguous")
        self.assertEqual(result["domain"], AMBIGUOUS_DOMAIN)
        self.assertIsNone(result["exam_task"])

    def test_marks_conflicting_primary_goals_ambiguous(self) -> None:
        result = self.classify(
            "The compute workload must minimize cost and provide the lowest possible latency and highest throughput.",
            "Use EC2 Spot Instances in a cluster placement group.",
        )

        self.assertEqual(result["domain_key"], "ambiguous")
        self.assertIn("3.2", result["candidate_tasks"])
        self.assertIn("4.2", result["candidate_tasks"])

    def test_official_domain_labels_match_the_exam_guide(self) -> None:
        self.assertEqual(
            [item["label"] for item in OFFICIAL_DOMAINS],
            [
                "Design Secure Architectures",
                "Design Resilient Architectures",
                "Design High-Performing Architectures",
                "Design Cost-Optimized Architectures",
            ],
        )

    def test_bank_document_exposes_ordered_domain_metadata(self) -> None:
        document = build_bank_document([{"id": 1}])

        self.assertEqual(document["exam_domains"], OFFICIAL_DOMAINS)
        self.assertEqual(document["ambiguous_domain"], AMBIGUOUS_DOMAIN)
        self.assertEqual(document["questions"], [{"id": 1}])


if __name__ == "__main__":
    unittest.main()
