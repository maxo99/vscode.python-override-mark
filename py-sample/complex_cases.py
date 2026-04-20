from abc import abstractmethod
from parents import Base, Mixin
import parents as p

# Case 1: Imported Parent
class StandardChild(Base):
    def speak(self):
        pass

# Case 2: Aliased
class AliasedChild(p.Base):
    def speak(self):
        pass




# Case 3: Multiple
class MultipleChild(Base, Mixin):
    def speak(self):
        pass

# Case 4: Multi-line
class MultiLineChild(
    Base,
    Mixin
):
    def speak(self):
        pass
    def walk(self):
        pass


# Case 5: Nested Parent/Child
class NestedParent(MultiLineChild):
    ...

class NestedChild(NestedParent):
    def speak(self):
        pass
    def walk(self):
        pass


# Case 6: Sandwich(Bread) - Both overrides and is overridden


class Bread:

    @abstractmethod
    def preperation(self) -> str:
        raise NotImplementedError

class Sandwich(Bread):

    def preperation(self) -> str:
        return 'endless'

    @property
    def hasTop(self) -> bool:
        return True

class Toast(Bread):
    
    def preperation(self) -> str:
        return 'toasted'

class Burger(Sandwich):

    def preperation(self) -> str:
        return 'grilled'

    @property
    def hasTop(self) -> bool:
        return super().hasTop


class HotDog(Bread):

    # HotDog is not a Sandwich (doesn't override hastop)
    @property
    def has_top(self):
        return False

    def preperation(self) -> str:
        return 'grilled'
