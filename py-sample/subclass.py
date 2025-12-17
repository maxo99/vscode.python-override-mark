from dataclasses import dataclass, Field, field


class ObjectA:
    def method_a(self):
        return "Method A from ObjectA"

class ObjectB(ObjectA):
    def method_b(self):
        return "Method B from ObjectB"
    


@dataclass
class OtherObject:
    a: ObjectA = field(default_factory=ObjectA)
    b: ObjectB = field(default_factory=ObjectB)


