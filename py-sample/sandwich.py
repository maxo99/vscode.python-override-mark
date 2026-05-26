from abc import abstractmethod

class Bread:

    @abstractmethod
    def preperation(self) -> str:
        raise NotImplementedError

class HotDog(Bread):

    # No override (HotDog is not a Sandwich)
    @property
    def hasTop(self):
        return False




    def preperation(self) -> str:
        return 'GRILLED'

class Sandwich(Bread):

    @property
    def hasTop(self) -> bool:
        return True

    def preperation(self) -> str:
        return 'ENDLESS'

class Toast(Bread):

    def preperation(self) -> str:
        return 'TOASTED'

class Burger(Sandwich):

    def preperation(self) -> str:
        return 'GRILLED'

    @property
    def hasTop(self) -> bool:
        return super().hasTop


