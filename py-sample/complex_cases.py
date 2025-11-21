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
    def prep(self) -> str:
        raise NotImplementedError

class Sandwich(Bread):

    # Sandwiches are endless
    def prep(self) -> str:
        return 'endless'

    @property
    def has_top(self) -> bool:
        return True

class Toast(Bread):
    
    def prep(self) -> str:
        return 'toasted'

class Burger(Sandwich):

    # Burger is best grilled
    def prep(self) -> str:
        return 'grilled'

    @property
    def has_top(self) -> bool:
        return super().has_top()


class HotDog(Bread):

    # HotDog is not a Sandwich (doesn't override hastop)
    @property
    def has_top(self):
        return False

    # HotDog is best grilled
    def prep(self) -> str:
        return 'grilled'
